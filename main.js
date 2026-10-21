let path = require('path');
let util = require('util');
let os = require('os');
let fs = require('fs');
let EventEmitter = require('events');
let electron = require('electron');
electron.remote = require('@electron/remote/main');
let {app, protocol, remote, session} = electron;

// Configure application identity
app.name = 'Bedrock';
if (app.setName) {
	app.setName('Bedrock');
}

remote.initialize();

protocol.registerSchemesAsPrivileged([
	{scheme: 'app', privileges: {standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true}}
]);

let updateEvents = new EventEmitter();

let insider = false;
let disable = false;
let silence = false;
updateEvents.on('insider', (arg) => {
	insider = arg;
});
updateEvents.on('disable', (arg) => {
	disable = arg;
});
updateEvents.on('silence', (arg) => {
	silence = arg;
});

let APP_PATH = (() => {
	let path = app.getAppPath();
	let asar_index = path.indexOf('app.asar');
	if (asar_index >= 0) {
		return path.slice(0, asar_index);
	}
	return path;
})();

let currentBaseVersion = app.getVersion();
let currentPackageVersion = currentBaseVersion;
let dataPath = app.getPath('userData');

// Ensure user data directory exists
try {
	if (!fs.existsSync(dataPath)) {
		fs.mkdirSync(dataPath, {recursive: true});
	}
} catch (e) {
}

function pad(number) {
	if (number < 10) {
		return '0' + number;
	}
	return number;
}

function stamp() {
	let d = new Date();
	return d.getUTCFullYear() +
		'-' + pad(d.getUTCMonth() + 1) +
		'-' + pad(d.getUTCDate()) +
		' ' + pad(d.getUTCHours()) +
		':' + pad(d.getUTCMinutes()) +
		':' + pad(d.getUTCSeconds());
}

function logger(logfile) {
	let fileout = fs.openSync(logfile, 'a');
	let stdout = process.stdout;

	stdout.on('error', function(e) {
		// `write` failed. Do nothing...
	});

	let fn = function () {
		let data = stamp() + ' ' + util.format.apply(null, arguments) + os.EOL;

		try {
			fs.writeSync(fileout, data);
			// Don't output to stdout if the app requests silence mode (to avoid polluting CLI outputs)
			if (!silence) stdout.write(data);
		}
		catch (e) {
			// Failed to write to log
		}
	};

	fn.end = function () {
		fs.closeSync(fileout);
	};

	return fn;
}

let log = logger(path.join(dataPath, 'bedrock.log'));

/**
 * Filter to block Obsidian servers, site, and non-plugin repository connections,
 * while leaving Obsidian community plugin and theme URLs intact.
 */
function isBlockedServerOrSite(urlStr) {
	try {
		let parsed = new URL(urlStr);
		// Only filter remote HTTP/HTTPS connections. Never block local internal schemes like app:// or file://
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return false;
		}

		let host = parsed.hostname.toLowerCase();

		// Obsidian official servers and site (e.g., obsidian.md, releases.obsidian.md, sync.obsidian.md, publish.obsidian.md)
		if (host === 'obsidian.md' || host.endsWith('.obsidian.md')) {
			return true;
		}

		// Obsidian releases repo on GitHub (e.g., raw.githubusercontent.com/obsidianmd/... or github.com/obsidianmd/...)
		if (
			(host === 'raw.githubusercontent.com' || host === 'github.com') &&
			parsed.pathname.toLowerCase().startsWith('/obsidianmd/')
		) {
			let path = parsed.pathname.toLowerCase();
			// Explicitly leave Obsidian Plugin and theme URLs intact so community plugins can be installed
			let isPluginOrTheme = path.includes('community-plugins') ||
				path.includes('community-plugin-stats') ||
				path.includes('community-css-themes') ||
				path.includes('community-theme-stats');

			if (isPluginOrTheme) {
				return false;
			}
			return true;
		}
	} catch (e) {
	}
	return false;
}

function setupWebRequestBlocking(sess) {
	if (!sess || !sess.webRequest) return;
	sess.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
		if (isBlockedServerOrSite(details.url)) {
			log('Blocked request to external server/site:', details.url);
			return callback({ cancel: true });
		}
		return callback({ cancel: false });
	});
}

// Attach web request interception to block Obsidian servers while preserving plugin network traffic
app.whenReady().then(() => {
	let targetSession = session && session.defaultSession ? session.defaultSession : electron.session && electron.session.defaultSession;
	if (targetSession) {
		setupWebRequestBlocking(targetSession);
	}
});

app.on('session-created', (sess) => {
	setupWebRequestBlocking(sess);
});

// Update checks from Obsidian servers are disabled
let queueUpdate = (manual) => {
	updateEvents.emit('check-start');
	log('Updater is disabled: external update connections have been removed.');
	updateEvents.emit('check-end');
};

function loadApp(targetPath) {
	if (!targetPath) return false;
	if (!fs.existsSync(targetPath)) {
		return false;
	}

	// Execute asar content or unpacked directory
	let main = path.join(targetPath, 'main.js');
	if (!fs.existsSync(main)) {
		log('Entrypoint main.js not found in package at', main);
		return false;
	}

	let fn;
	try {
		fn = require(main);
	} catch (e) {
		log('Failed to execute app entrypoint at ' + main + ':', e && e.stack ? e.stack : e);
		return false;
	}

	if (fn && typeof fn === 'function') {
		fn(targetPath, updateEvents);
		return true;
	}
	return false;
}

function extractVersion(filename) {
	if (filename.startsWith('bedrock-') && filename.endsWith('.asar')) {
		return filename.substring('bedrock-'.length, filename.length - '.asar'.length);
	}
	if (filename.startsWith('obsidian-') && filename.endsWith('.asar')) {
		return filename.substring('obsidian-'.length, filename.length - '.asar'.length);
	}
	return null;
}

function parseVersion(string) {
	if (!string) {
		return null;
	}
	let valid = true;
	let parts = string.split('.').map((part) => {
		part = parseInt(part);
		if (isNaN(part)) {
			valid = false;
		}
		return part;
	});
	if (valid) {
		return parts;
	}
	return null;
}

function isMoreRecent(version1, version2) {
	let length = Math.min(version1.length, version2.length);
	for (let i = 0; i < length; i++) {
		if (version1[i] < version2[i]) {
			return true;
		}
		if (version1[i] > version2[i]) {
			return false;
		}
	}
	if (version1.length < version2.length) {
		return true;
	}
	if (version1.length > version2.length) {
		return false;
	}
	return false;
}

function isV2MoreRecent(v1, v2) {
	let version1 = parseVersion(v1);
	let version2 = parseVersion(v2);
	if (!version2) {
		return false;
	}
	if (!version1) {
		return true;
	}
	return isMoreRecent(version1, version2);
}

// Source: https://github.com/electron/electron/blob/19954126e08c67022b89a886cadb10471ac853ae/lib/browser/init.ts#L20
process.on('uncaughtException', function (error) {
	// Don't emit errors for updater
	if (error.message && error.message.indexOf('net::ERR') !== -1) {
		return;
	}

	console.error('Uncaught Exception', error);

	// Show error in GUI.
	import('electron')
		.then(({dialog}) => {
			const stack = error.stack ? error.stack : `${error.name}: ${error.message}`;
			const message = 'Uncaught Exception:\n' + stack;
			dialog.showErrorBox('A JavaScript error occurred in the main process', message);
		});
});

// Helper to scan a directory for versioned asar packages
function findHighestVersionAsar(dir) {
	let highestFile = '';
	let highestVersion = '';
	try {
		if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
			let files = fs.readdirSync(dir, {withFileTypes: true});
			for (let file of files) {
				let filename = file.name;
				if (file.isFile() && (filename.startsWith('bedrock-') || filename.startsWith('obsidian-')) && filename.endsWith('.asar')) {
					let newVersion = extractVersion(filename);
					if (isV2MoreRecent(highestVersion, newVersion)) {
						highestFile = filename;
						highestVersion = newVersion;
					}
				}
			}
		}
	} catch (e) {
	}
	return {filename: highestFile, version: highestVersion};
}

let updatedAsarPath = '';
let updatedAsarVersion = '';

// 1. Check dataPath (userData) for updated asar
let primaryCandidate = findHighestVersionAsar(dataPath);
if (primaryCandidate.filename) {
	updatedAsarPath = path.join(dataPath, primaryCandidate.filename);
	updatedAsarVersion = primaryCandidate.version;
}

// 2. Fallback: Check legacy Obsidian userData directory if nothing found in Bedrock userData
if (!updatedAsarPath) {
	try {
		let legacyDir = path.join(app.getPath('appData'), 'obsidian');
		let legacyCandidate = findHighestVersionAsar(legacyDir);
		if (legacyCandidate.filename) {
			let sourceFile = path.join(legacyDir, legacyCandidate.filename);
			let destFile = path.join(dataPath, legacyCandidate.filename.replace(/^obsidian-/, 'bedrock-'));
			try {
				fs.copyFileSync(sourceFile, destFile);
				updatedAsarPath = destFile;
				updatedAsarVersion = legacyCandidate.version;
				log('Imported legacy package from ' + sourceFile + ' to ' + destFile);
			} catch (copyErr) {
				updatedAsarPath = sourceFile;
				updatedAsarVersion = legacyCandidate.version;
			}
		}
	} catch (e) {
	}
}

// Resolve base package locations
let candidateBasePaths = [
	path.join(APP_PATH, 'bedrock.asar'),
	path.join(APP_PATH, 'obsidian.asar'),
	path.join(APP_PATH, 'bedrock'),
	path.join(APP_PATH, 'obsidian'),
	path.join(APP_PATH, '..', 'bedrock.asar'),
	path.join(APP_PATH, '..', 'obsidian.asar'),
	path.join(APP_PATH, '..', 'resources', 'bedrock.asar'),
	path.join(APP_PATH, '..', 'resources', 'obsidian.asar')
];

let asarPath = '';
for (let candidate of candidateBasePaths) {
	if (fs.existsSync(candidate)) {
		asarPath = candidate;
		break;
	}
}

let success = false;
if (updatedAsarPath) {
	success = loadApp(updatedAsarPath);
	if (success) {
		currentPackageVersion = updatedAsarVersion;
		log('Loaded updated app package', updatedAsarPath);
	}
}

if (!success && asarPath) {
	success = loadApp(asarPath);
	if (success) {
		log('Loaded main app package', asarPath);
	}
}

if (!success) {
	log('Failed to load app packages. Looked in: ' + candidateBasePaths.join(', '));
}

// Handle update check requests cleanly without contacting external servers
updateEvents.on('check', () => queueUpdate(true));
