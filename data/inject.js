/* globals self */
'use strict';

var prompt  = (function () {
  let iframe, div;
  function hide () {
    if (iframe && div) {
      div.style.display = 'none';
      iframe.src = 'about:blank';
    }
  }
  return {
    show: function (id) {
      id = encodeURIComponent(id);
      if (iframe) {
        iframe.src = id === 'undefined' ? self.options.ecleaner : self.options.list + '?id=' + id;
        div.style.display = 'flex';
      }
      else {
        let main = document.getElementsByClassName('main-content');
        if (main && main.length) {
          main = main[0];
          div = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
          div.setAttribute('style', 'display: flex; position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; background-color: rgba(0, 0, 0, 0.2); align-items: center; justify-content: center;');
          iframe = document.createElementNS('http://www.w3.org/1999/xhtml', 'iframe');
          iframe.src = id === 'undefined' ? self.options.ecleaner : self.options.list + '?id=' + id;
          iframe.setAttribute('style', 'width: 60%; height: 80%; background-color: rgb(255, 255, 255); border: medium none;');
          div.appendChild(iframe);
          main.appendChild(div);
          div.addEventListener('click', hide);
        }
      }
    },
    hide: hide,
    detach: function () {
      if (div) {
        div.parentNode.removeChild(div);
      }
    }
  };
})();

self.port.on('cancel', prompt.hide);
self.port.on('prompt', prompt.show);
self.on('detach', prompt.detach);
