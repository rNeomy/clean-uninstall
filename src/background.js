'use strict';

var self = require('sdk/self');
var tabs = require('sdk/tabs');
var timers = require('sdk/timers');
var unload = require('sdk/system/unload');
var notifications = require('sdk/notifications');
var array = require('sdk/util/array');
var pageMod = require('sdk/page-mod');
var sp = require('sdk/simple-prefs');
var {Cc, Ci, Cu} = require('chrome');

var {AddonManager} = Cu.import('resource://gre/modules/AddonManager.jsm');
var prefService = Cc['@mozilla.org/preferences-service;1'].getService(Ci.nsIPrefService);

//Polyfill
if (!Object.values) {
  let reduce = Function.bind.call(Function.call, Array.prototype.reduce);
  let isEnumerable = Function.bind.call(Function.call, Object.prototype.propertyIsEnumerable);
  let concat = Function.bind.call(Function.call, Array.prototype.concat);
  let keys = Reflect.ownKeys;

  Object.values = function values (O) {
    return reduce(keys(O), (v, k) => concat(v, typeof k === 'string' && isEnumerable(O, k) ? [O[k]] : []), []);
  };
}

var cache = {};
var workers = [];

function notify (text) {
  notifications.notify({
    title: 'Clean Uninstall',
    iconURL: './icons/64.png',
    text
  });
}

var map = {
  '{b9db16a4-6edc-47ec-a1f4-b86292ed211d}': 'dwhelper', // Video DownloadHelper
  '{DDC359D1-844A-42a7-9AA1-88A850A938A8}': 'dta', // DownThemAll!
  'artur.dubovoy@gmail.com': 'fvd_single', // Flash Video Downloader - YouTube HD Download
  '{dc572301-7619-498c-a57d-39143191b318}': 'tabmix', // Tab Mix Plus
  'uBlock0@raymondhill.net': 'ublock0', // uBlock Origin
  'translator@zoli.bod': 'googletranslatorforff', // Google Translator for Firefox
  '{bee6eb20-01e0-ebd1-da83-080329fb9a3a}': 'fnvfox', // Download Flash and Video
  '{81BF1D23-5F17-408D-AC6B-BD6DF7CAF670}': 'imacros', // iMacros for Firefox
  '{d40f5e7b-d2cf-4856-b441-cc613eeffbe3}': 'bprivacy', // BetterPrivacy
  'anttoolbar@ant.com': 'anttoolbar', // BetterPrivacy
  'inspector@mozilla.org': 'inspector', // DOM Inspector
  '{a0d7ccb3-214d-498b-b4aa-0e8fda9a7bf7}': 'weboftrust', // WOT
  '{1BC9BA34-1EED-42ca-A505-6D2F1A935BBB}': 'ietab2', // IE Tab 2
  'jid0-GjwrPchS3Ugt7xydvqVK4DQk8Ls@jetpack': 'autoinstaller', // Extension Auto-Installer
  'autoinstaller@adblockplus.org': 'autoinstaller@adblockplus', // Extension Auto-Installer
  '{d10d0bf8-f5b5-c8b4-a8b2-2b9879e08c5d}': 'adblockplus', // Adblock Plus
  '{1018e4d6-728f-4b20-ad56-37578a4de76b}': 'flagfox', // Flagfox
  'savedpasswordeditor@daniel.dawson': 'savedpasswordeditor', // Saved Password Editor
  'privateTab@infocatcher': 'privateTab', // Private Tab
  '{46551EC9-40F0-4e47-8E18-8E5CF550CFB8}': 'stylish', // Stylish
};

var eCleaner = (function () {
  let reserved = [
    'pocket', 'xpiState', 'webExtensionsMinPlatformVersion', 'systemAddon', 'systemAddonSet', 'strictCompatibility',
    'alwaysUnpack', 'blocklist', 'bootstrappedAddons', 'databaseSchema', 'dss', 'enabledAddons', 'enabledItems',
    'getAddons', 'getMoreThemesURL', 'installCache', 'lastAppVersion', 'logging', 'pendingOperations', 'spellcheck',
    'webservice', 'change', 'checkCompatibility', 'minCompatibleAppVersion', 'minCompatiblePlatformVersion',
    'installedDistroAddon', 'modern@themes', 'input', 'lastPlatformVersion', 'ui', 'update', 'autoDisableScopes',
    'installDistroAddons', 'enabledScopes', 'shownSelectionUI', 'sdk', 'hotfix',
    '{972ce4c6-7e08-4474-a285-3208198ce6fd}', 'e10sBlockedByAddons'
  ];
  return function () {
    let cache = {};
    prefService.getBranch('extensions.').getChildList('',{})
      .map(n => n.split('.')[0])
      .filter(n => reserved.indexOf(n) === -1)
      .filter((n, i, l) => {
        let bol = l.indexOf(n) === i;
        if (bol) {
          cache[n] = 1;
        }
        else {
          cache[n] += 1;
        }
        return bol;
      });
    return cache;
  };
})();
sp.on('ecleaner', function () {
  workers.filter(w => w.tab === tabs.activeTab).forEach(w => w.port.emit('prompt'));
});

function cleanup (aid, name) {
  // do not self clean
  if (aid === self.id) {
    return;
  }
  name = name.replace(/\s+/g, '').replace(/\-/g, '').toLowerCase();

  cache[aid] = [];
  let list = [].concat(
    prefService.getBranch('extensions.' + aid).getChildList('',{}).map(n => `extensions.${aid + n}`),
    prefService.getBranch(aid).getChildList('',{}).map(n => aid + n),
    prefService.getBranch('extensions.' + name).getChildList('',{}).map(n => `extensions.${name + n}`),
    prefService.getBranch(name).getChildList('',{}).map(n => name + n)
  );
  if (map[aid]) {
    list = list.concat(
      prefService.getBranch('extensions.' + map[aid]).getChildList('',{}).map(n => `extensions.${map[aid] + n}`),
      prefService.getBranch(map[aid]).getChildList('',{}).map(n => map[aid] + n)
    );
  }
  if (aid.indexOf('@') !== -1 && aid.indexOf('@') !== 0) {
    let rr = aid.split('@')[0];
    list = list.concat(
      prefService.getBranch('extensions.' + rr).getChildList('',{}).map(n => `extensions.${rr + n}`),
      prefService.getBranch(rr).getChildList('',{}).map(n => rr + n)
    );
  }

  list.filter((e, i, l) => l.indexOf(e) === i).forEach(function (id) {
    let branch = prefService.getBranch(id);
    let type = branch.getPrefType('');
    if (type === branch.PREF_BOOL) {
      cache[aid].push({
        id,
        value: branch.getBoolPref(''),
        type: branch.PREF_BOOL
      });
    }
    if (type === branch.PREF_INT) {
      cache[aid].push({
        id,
        value: branch.getIntPref(''),
        type: branch.PREF_INT
      });
    }
    if (type === branch.PREF_STRING) {
      cache[aid].push({
        id,
        value: branch.getComplexValue('', Ci.nsISupportsString).data,
        type: branch.PREF_STRING
      });
    }
  });

  if (list.length) {
    workers.filter(w => w.tab === tabs.activeTab).forEach(w => w.port.emit('prompt', aid));
  }
  else {
    notify('No preference associated to this extension is found');
  }
}

function restore (aid) {
  let arr = (cache[aid] || []).filter(o => o.removed);
  if (arr.length) {
    arr.forEach(function (obj) {
      let branch = prefService.getBranch(obj.id);
      if (obj.type === branch.PREF_BOOL) {
        branch.setBoolPref('', obj.value);
      }
      if (obj.type === branch.PREF_INT) {
        branch.setIntPref('', obj.value);
      }
      if (obj.type === branch.PREF_STRING) {
        let str = Cc['@mozilla.org/supports-string;1'].createInstance(Ci.nsISupportsString);
        str.data = obj.value;
        branch.setComplexValue('', Ci.nsISupportsString, str);
      }
    });
    notify(`${arr.length} preference(s) associated to this extension are resotred`);
  }
}

var listen = {
  onEnabling: (addon) => restore(addon.id),
  onEnabled: function () {},
  onDisabling: (addon) => {
    console.error(addon.type)
    cleanup(addon.id, addon.name)
  },
  onDisabled: function () {},
  onInstalling: function () {},
  onInstalled: function () {},
  onUninstalled: function () {},
  onUninstalling: (addon) => addon.type === 'extension' ? cleanup(addon.id, addon.name) : null,
  onOperationCancelled: (addon) => addon.type === 'extension' ? cleanup(addon.id, addon.name) : null,
  onPropertyChanged: function () {}
};

AddonManager.addAddonListener(listen);
unload.when(function () {
  AddonManager.removeAddonListener(listen);
});

function inject (tab) {
  let worker = tab.attach({
    contentScriptFile: self.data.url('inject.js'),
    contentScriptOptions: {
      list: self.data.url('list.html'),
      ecleaner: self.data.url('eCleaner/index.html')
    }
  });
  array.add(workers, worker);
  (function (callback) {
    worker.on('pagehide', callback);
    worker.on('detach', callback);
  })(function () {
    array.remove(workers, this);
  });
  worker.on('pageshow', function () {
    array.add(workers, this);
  });
}
pageMod.PageMod({
  include: self.data.url('list.html') + '*',
  contentScriptFile: self.data.url('list.js'),
  onAttach: function (worker) {
    worker.port.on('remove', function (obj) {
      prefService.getBranch(obj.pref).deleteBranch('');
      let index = cache[obj.id].reduce((p, c, i) => c.id === obj.pref ? i : p, -1);
      if (index !== -1) {
        cache[obj.id][index].removed = true;
      }
    });
    worker.port.on('cancel', function () {
      workers.filter(w => w.tab === worker.tab).forEach(w => w.port.emit('cancel'));
    });
    worker.port.on('init', function (id) {
      worker.port.emit('init', cache[id]);
    });
    worker.port.on('notify', notify);
  }
});
pageMod.PageMod({
  include: self.data.url('eCleaner/index.html'),
  contentScriptFile: self.data.url('eCleaner/index.js'),
  onAttach: function (worker) {
    worker.port.on('remove', function (branch) {
      prefService.getBranch(`extensions.${branch}`).deleteBranch('');
    });
    worker.port.on('cancel', function () {
      workers.filter(w => w.tab === worker.tab).forEach(w => w.port.emit('cancel'));
    });
    worker.port.on('init', function () {
      let items = eCleaner();
      if (Object.keys(items).length) {
        worker.port.emit('init', items);
      }
      else {
        timers.setTimeout(function () {
          workers.filter(w => w.tab === worker.tab).forEach(w => w.port.emit('cancel'));
        }, 5000);
        notify('Good news, your Firefox profile is clean!');
      }
    });
    worker.port.on('notify', notify);
    worker.port.on('name', function (id) {
      let index = Object.values(map).indexOf(id);
      AddonManager.getAddonByID(index !== -1 ? Object.keys(map)[index] : id, function (addon) {
        worker.port.emit('name', {
          id,
          name: addon ? addon.name : (id.indexOf('@jetpack') === -1 ? 'unknown add-on' : 'a removed add-on'),
          value: !addon && id.indexOf('@jetpack') !== -1,
          disabled: !!addon
        });
      });
    });
  }
});

tabs.on('ready', function (tab) {
  if (tab.url === 'about:addons') {
    inject(tab);
  }
});
for (let tab of tabs) {
  if (tab.url === 'about:addons') {
    inject(tab);
  }
}

exports.main = function (options) {
  if (options.loadReason === 'install' || options.loadReason === 'startup') {
    let version = sp.prefs.version;
    if (self.version !== version) {
      timers.setTimeout(function () {
        tabs.open(
          'http://firefox.add0n.com/clean-uninstall.html?v=' + self.version +
          (version ? '&p=' + version + '&type=upgrade' : '&type=install')
        );
      }, 3000);
      sp.prefs.version = self.version;
    }
  }
};
