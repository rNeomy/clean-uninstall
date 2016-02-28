/* globals self */
'use strict';

var id;

document.addEventListener('click', function (e) {
  let target = e.target;
  let cmd = target.dataset.cmd;
  if (cmd === 'all') {
    Array.from(document.querySelectorAll('[type=checkbox]')).forEach(e => e.checked = true);
  }
  if (cmd === 'none') {
    Array.from(document.querySelectorAll('[type=checkbox]')).forEach(e => e.checked = false);
  }
  if (cmd === 'cancel') {
    self.port.emit('cancel');
  }
  if (cmd === 'remove') {
    let list = Array.from(document.querySelectorAll('[type=checkbox]:checked'))
      .map(e => e.parentNode.previousSibling.textContent);
    list.forEach(pref => self.port.emit('remove', {id, pref}));
    if (list.length) {
      if (list.length === 1) {
        self.port.emit('notify', `1 preference is removed from your Firefox Profile`);
      }
      else {
        self.port.emit('notify', `${list.length} preferences are removed from your Firefox Profile`);
      }
    }
    self.port.emit('cancel');
  }
});

self.port.on('init', function (arr) {
  document.querySelector('p').textContent = `Total number of preferences created by this extension is: ${arr.length}`;
  let tbody = document.querySelector('tbody');
  arr.forEach(function (obj) {
    let tr = document.createElement('tr');
    let one = document.createElement('td');
    one.textContent = obj.id;
    let two = document.createElement('td');
    let checkbox = document.createElement('input');
    checkbox.setAttribute('type', 'checkbox');
    checkbox.setAttribute('checked', true);
    two.appendChild(checkbox);
    tr.appendChild(one);
    tr.appendChild(two);
    tbody.appendChild(tr);
  });
});

var tmp = /id\=([^\&]+)/.exec(document.location.search);
if (tmp && tmp.length) {
  id = decodeURIComponent(tmp[1]);
  self.port.emit('init', id);
}
