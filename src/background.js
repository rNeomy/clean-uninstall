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
};

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

  list.forEach(function (id) {
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
  onDisabling: function () {},
  onDisabled: function () {},
  onInstalling: function () {},
  onInstalled: function () {},
  onUninstalling: (addon) => cleanup(addon.id, addon.name),
  onUninstalled: function () {},
  onOperationCancelled: (addon) => restore(addon.id),
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
      url: self.data.url('list.html')
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
