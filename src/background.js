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

var map = require('./map.js').mirror;

var {AddonManager} = Cu.import('resource://gre/modules/AddonManager.jsm');
var prefService = Cc['@mozilla.org/preferences-service;1'].getService(Ci.nsIPrefService);

//Polyfill
if (!Object.values) {
  Object.values = function (O) {
    let arr = [];
    for (let name in O) {
      arr.push(O[name]);
    }
    return arr;
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

var eCleaner = (function () {
  let reserved = [
    'pocket', 'xpiState', 'webExtensionsMinPlatformVersion', 'systemAddon', 'systemAddonSet', 'strictCompatibility',
    'alwaysUnpack', 'blocklist', 'bootstrappedAddons', 'databaseSchema', 'dss', 'enabledAddons', 'enabledItems',
    'getAddons', 'getMoreThemesURL', 'installCache', 'lastAppVersion', 'logging', 'pendingOperations', 'spellcheck',
    'webservice', 'change', 'checkCompatibility', 'minCompatibleAppVersion', 'minCompatiblePlatformVersion',
    'installedDistroAddon', 'modern@themes', 'input', 'lastPlatformVersion', 'ui', 'update', 'autoDisableScopes',
    'installDistroAddons', 'enabledScopes', 'shownSelectionUI', 'sdk', 'hotfix',
    '{972ce4c6-7e08-4474-a285-3208198ce6fd}', 'e10sBlockedByAddons', 'sdk-toolbar-collapsed'
  ];
  return function (callback) {
    let cache = {};
    AddonManager.getAllAddons(function(aAddons) {
      let installed = aAddons.map(a => a.id);
      prefService.getBranch('extensions.').getChildList('',{})
        .map(function (name) {
          let listed = installed.reduce((p, c) => name.indexOf(c) === 0 ? c : p, null);
          return listed || name.split('.')[0];
        })
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
      callback(cache);
    });
  };
})();
sp.on('ecleaner', function () {
  workers.filter(w => w.tab === tabs.activeTab).forEach(w => w.port.emit('prompt'));
});

function cleanup (addon, method) {
  if (addon.type !== 'extension') {
    return;
  }
  if (method !== 'onUninstalling' &&  addon.operationsRequiringRestart !== AddonManager.OP_NEEDS_RESTART_NONE) {
    return;
  }

  let aid = addon.id, name = addon.name;
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

function restore (addon) {
  if (addon.type !== 'extension') {
    return;
  }
  let aid = addon.id;
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
  onEnabling: restore,
  onEnabled: function () {},
  onDisabling: (addon) => cleanup(addon, 'onDisabling'),
  onDisabled: function () {},
  onInstalling: function () {},
  onInstalled: function () {},
  onUninstalled: function () {},
  onUninstalling: (addon) => cleanup(addon, 'onUninstalling'),
  onOperationCancelled: function () {},
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
      eCleaner(function (items) {
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
    });
    worker.port.on('notify', notify);
    worker.port.on('name', function (id) {
      let index = Object.values(map).indexOf(id);
      AddonManager.getAddonByID(index !== -1 ? Object.keys(map)[index] : id, function (addon) {
        let name = 'unknown add-on';
        if (id.indexOf('@jetpack') !== -1) {
          name = 'a removed bootstrapped add-on';
        }
        if (index !== -1) {
          name = `a removed classical add-on; GUID is "${Object.keys(map)[index]}"`;
        }
        if (addon) {
          name = addon.name;
        }
        worker.port.emit('name', {
          id,
          name,
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
