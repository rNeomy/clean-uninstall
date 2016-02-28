/* globals self */
'use strict';

document.addEventListener('click', function (e) {
  let target = e.target;
  let cmd = target.dataset.cmd;
  if (cmd === 'all') {
    Array.from(document.querySelectorAll('[type=checkbox]'))
      .filter(e => e.parentNode.parentNode.dataset.disabled !== 'true')
      .forEach(e => e.checked = true);
  }
  if (cmd === 'none') {
    Array.from(document.querySelectorAll('[type=checkbox]')).forEach(e => e.checked = false);
  }
  if (cmd === 'cancel') {
    self.port.emit('cancel');
  }
  if (cmd === 'remove') {
    let list = Array.from(document.querySelectorAll('[type=checkbox]:checked'))
      .map(e => e.dataset.branch);
    list.forEach(branch => self.port.emit('remove', branch));
    if (list.length) {
      if (list.length === 1) {
        self.port.emit('notify', `1 branch is removed from your Firefox Profile`);
      }
      else {
        self.port.emit('notify', `${list.length} branches are removed from your Firefox Profile`);
      }
    }
    self.port.emit('cancel');
  }
});

self.port.on('name', function (obj) {
  let checkbox = document.querySelector(`[data-branch="${obj.id}"]`);
  if (checkbox) {
    checkbox.parentNode.previousSibling.previousSibling.textContent = obj.name;
    checkbox.checked = obj.value;
    if (obj.disabled) {
      checkbox.parentNode.parentNode.dataset.disabled = true;
    }
  }
});

self.port.on('init', function (obj) {
  let parent = document.querySelector('tbody');
  for (let name in obj) {
    let tr = document.createElement('tr');
    let td1 = document.createElement('td');
    td1.textContent = name;
    let td2 = document.createElement('td');
    td2.textContent = 'searching ...';
    let td3 = document.createElement('td');
    td3.textContent = obj[name];
    let td4 = document.createElement('td');
    let checkbox = document.createElement('input');
    checkbox.setAttribute('type', 'checkbox');
    checkbox.dataset.branch = name;
    td4.appendChild(checkbox);

    tr.appendChild(td1);
    tr.appendChild(td2);
    tr.appendChild(td3);
    tr.appendChild(td4);
    parent.appendChild(tr);
    self.port.emit('name', name);
  }
});
self.port.emit('init');
