/* global PARENT_ORIGIN */
/* Trusted bridge. Generated JavaScript never executes in this DOM. */
(() => {
  'use strict';
  let initialized = false;
  let channel;
  let worker;
  const root = document.getElementById('site-root');
  const send = data => parent.postMessage({ channel, ...data }, PARENT_ORIGIN);
  const reportSize = () => send({ type: 'size', height: Math.min(16000, Math.max(500, document.documentElement.scrollHeight)) });
  addEventListener('message', async (event) => {
    if (initialized || event.source !== parent || event.origin !== PARENT_ORIGIN || event.data?.type !== 'initialize') {
      return;
    }
    const { payload } = event.data;
    if (!payload?.source || typeof event.data.channel !== 'string') {
      return;
    }
    initialized = true;
    channel = event.data.channel;
    const { source, data, images } = payload;
    const css = document.createElement('style');
    css.textContent = `html{scroll-behavior:smooth}body{margin:0}*{box-sizing:border-box}img{max-width:100%;height:auto}button{font:inherit;cursor:pointer}a,button{touch-action:manipulation}:focus-visible{outline:3px solid #3685ff;outline-offset:4px}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}\n${source.css}`;
    document.head.append(css);
    // Source passed here has been parsed, validated and canonicalized by the
    // server. CSP additionally disallows inline handlers and injected scripts.
    root.innerHTML = source.html;
    const template = root.querySelector('template[data-luster-service]');
    const container = root.querySelector('[data-luster-services]');
    function bind(element, service) {
      element.querySelectorAll('[data-luster-field]').forEach((node) => {
        const [kind, field] = node.dataset.lusterField.split('.');
        node.textContent = String((kind === 'service' ? service : data.business)?.[field] ?? '');
      });
      element.querySelectorAll('[data-luster-book]').forEach((node) => {
        node.dataset.lusterBook = service?.id ?? '';
      });
    }
    if (template && container) {
      data.services.forEach((service) => {
        const fragment = template.content.cloneNode(true);
        bind(fragment, service);
        container.append(fragment);
      });
    }
    template?.remove();
    root.querySelectorAll('[data-luster-field^="business."]').forEach((node) => {
      node.textContent = String(data.business[node.dataset.lusterField.split('.')[1]] ?? '');
    });
    root.querySelectorAll('img').forEach((node) => {
      const image = images[node.getAttribute('src')?.replace(/^asset:/, '')];
      if (typeof image === 'string' && /^data:image\/(?:webp|png|jpeg);base64,/.test(image)) {
        node.src = image;
      } else {
        node.removeAttribute('src');
      }
    });
    root.addEventListener('click', (event) => {
      if (!event.isTrusted) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const book = target?.closest('[data-luster-book]');
      const manage = target?.closest('[data-luster-manage]');
      if (book || manage) {
        event.preventDefault();
        if (data.preview) {
          send({ type: 'preview-booking' });
          return;
        }
        const serviceId = book?.dataset.lusterBook ?? '';
        if (serviceId && !data.services.some(s => s.id === serviceId)) {
          return;
        }
        send({ type: manage ? 'manage' : 'book', serviceId });
      }
      if (target?.id) {
        worker?.postMessage({ type: 'click', id: target.id, width: innerWidth });
      }
    });
    if (source.javascript) {
      // No navigation API or document in the worker. Browser CSP blocks network
      // and imports. Nested workers are removed before untrusted code runs.
      const workerSource = `'use strict';\nconst send = self.postMessage.bind(self);\nconst handlers = [];\nObject.defineProperty(self, 'Worker', {value:undefined,writable:false,configurable:false});\nObject.defineProperty(self, 'SharedWorker', {value:undefined,writable:false,configurable:false});\nObject.defineProperty(self, 'BroadcastChannel', {value:undefined,writable:false,configurable:false});\nconst Luster = Object.freeze({data:${JSON.stringify(data)},on: fn=>{if(typeof fn==='function' && handlers.length<20)handlers.push(fn)},update: op=>send({type:'update',op})});\nsetInterval(()=>send({type:'heartbeat'}),200);\nself.addEventListener('message',event=>{for(const handler of handlers)handler(event.data)});\n${source.javascript}`;
      const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
      worker = new Worker(url);
      // WebKit loads worker blobs asynchronously. Keep the URL until the first
      // heartbeat (or termination), otherwise valid interactions can fail to load.
      let released = false;
      const release = () => {
        if (!released) {
          URL.revokeObjectURL(url);
          released = true;
        }
      };
      let heartbeat = Date.now();
      let count = 0;
      const watchdog = setInterval(() => {
        count = 0;
        if (Date.now() - heartbeat > 1500) {
          worker.terminate();
          release();
          clearInterval(watchdog);
          send({ type: 'interaction-stopped', reason: 'watchdog' });
        }
      }, 500);
      worker.onmessage = ({ data: message }) => {
        if (message?.type === 'heartbeat') {
          release();
          heartbeat = Date.now();
          return;
        }
        if (++count > 100 || message?.type !== 'update') {
          return;
        }
        const op = message.op;
        if (!op || typeof op.selector !== 'string' || !/^[.#][a-z][\w-]{0,70}$/i.test(op.selector)) {
          return;
        }
        // Only visual operations. Never attributes, URLs, HTML, scripts, forms,
        // booking identifiers, parent messages, or canonical data bindings.
        root.querySelectorAll(op.selector).forEach((node) => {
          if (typeof op.text === 'string' && op.text.length <= 2000 && !node.hasAttribute('data-luster-field') && !node.querySelector('[data-luster-field],[data-luster-book]')) {
            node.textContent = op.text;
          }
          if (typeof op.className === 'string' && /^[a-z][\w-]{0,70}$/i.test(op.className)) {
            node.classList.toggle(op.className, op.enabled === true);
          }
          if (typeof op.hidden === 'boolean') {
            node.hidden = op.hidden;
          }
          if (typeof op.expanded === 'boolean') {
            node.setAttribute('aria-expanded', String(op.expanded));
          }
          if (typeof op.cssVariable === 'string' && /^--[a-z][\w-]{0,50}$/i.test(op.cssVariable) && typeof op.value === 'string' && op.value.length < 120 && !/[\\<;]|url|image-set|expression/i.test(op.value)) {
            node.style.setProperty(op.cssVariable, op.value);
          }
        });
      };
      worker.onerror = () => {
        worker.terminate();
        release();
        clearInterval(watchdog);
        send({ type: 'interaction-stopped', reason: 'error' });
      };
    }
    new ResizeObserver(reportSize).observe(root);
    addEventListener('resize', () => worker?.postMessage({ type: 'resize', id: '', width: innerWidth }));
    reportSize();
    send({ type: 'rendered' });
  });
  const ready = setInterval(() => {
    if (initialized) {
      clearInterval(ready);
    } else {
      parent.postMessage({ type: 'renderer-ready' }, PARENT_ORIGIN);
    }
  }, 250);
  parent.postMessage({ type: 'renderer-ready' }, PARENT_ORIGIN);
})();
