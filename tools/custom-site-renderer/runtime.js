/* global PARENT_ORIGIN, TRUSTED_FONT_CSS */
/* Trusted bridge. Generated JavaScript never executes in this DOM. */
(() => {
  'use strict';
  let initialized = false;
  let channel;
  let worker;
  const nativeImages = new Map();
  const visiblePhotos = new WeakSet();
  const pendingPhotos = new Set();
  const root = document.getElementById('site-root');
  // The renderer boot hash covers this fixed bundle. It is never supplied by
  // the model, payload, admin origin or an external font server.
  const fonts = document.createElement('style');
  fonts.textContent = TRUSTED_FONT_CSS;
  document.head.append(fonts);
  const send = data => parent.postMessage({ channel, ...data }, PARENT_ORIGIN);
  function photoStatus(node, failed) {
    const status = node.closest('figure')?.querySelector('[data-luster-native-status]');
    if (status) {
      status.hidden = !failed;
    }
  }
  addEventListener('message', (event) => {
    if (!initialized || event.source !== parent || event.origin !== PARENT_ORIGIN || event.data?.type !== 'native-image' || event.data.channel !== channel) {
      return;
    }
    const nodes = nativeImages.get(event.data.mediaId);
    if (!nodes || !pendingPhotos.has(event.data.mediaId)) {
      return;
    }
    pendingPhotos.delete(event.data.mediaId);
    const value = event.data.dataUrl;
    const valid = typeof value === 'string' && value.length <= 5000100 && /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
    for (const node of nodes) {
      if (visiblePhotos.has(node)) {
        photoStatus(node, !valid);
        if (valid) {
          node.src = value;
        }
      }
    }
  });
  function emailHref(value) {
    // Bound the work and parse the separators directly. Overlapping domain
    // quantifiers can backtrack on hostile input; query/header injection is
    // never a supported contact action.
    if (typeof value !== 'string' || value.length > 254 || !/^[^\s?:#%]+$/.test(value)) {
      return null;
    }
    if ([...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
      return null;
    }
    const parts = value.split('@');
    if (parts.length !== 2 || !parts[0] || !parts[1].includes('.') || parts[1].split('.').some(label => !label)) {
      return null;
    }
    return `mailto:${value}`;
  }
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
    document.documentElement.lang = typeof source.language === 'string' && source.language.length <= 35 && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(source.language) ? source.language : 'en';
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
    const details = data.details ?? {};
    const detailText = { ...details };
    for (const section of details.sections ?? []) {
      detailText[`title_${section.id}`] = section.title;
      detailText[`section_${section.id}`] = section.text;
    }
    root.querySelectorAll('[data-luster-field^="details."]').forEach((node) => {
      node.textContent = String(detailText[node.dataset.lusterField.slice(8)] ?? '');
    });
    // Policy visibility is determined on the server from the canonical booking
    // settings. Removing it later must clear old source text, not leave a copy.
    const policy = data.bookingPolicy;
    root.querySelectorAll('[data-luster-field^="booking."]').forEach((node) => {
      node.textContent = String((node.dataset.lusterField === 'booking.policyTitle' ? policy?.title : policy?.text) ?? '');
    });
    root.querySelectorAll('[data-luster-booking-policy]').forEach((node) => {
      node.hidden = !policy?.text;
    });
    // Only trusted contact bindings can navigate; generated hrefs remain forbidden.
    root.querySelectorAll('a[data-luster-link]').forEach((node) => {
      const kind = node.dataset.lusterLink;
      const value = details[kind];
      let href = null;
      if (kind === 'instagram' && typeof value === 'string' && /^@?[\w.]{1,30}$/.test(value)) {
        href = `https://www.instagram.com/${value.replace(/^@/, '')}/`;
      }
      if (kind === 'email') {
        href = emailHref(value);
      }
      if (kind === 'phone' && typeof value === 'string' && /^\+?[0-9 ()-]{7,30}$/.test(value)) {
        href = `tel:${value.replace(/[^+0-9]/g, '')}`;
      }
      if (href) {
        node.href = href;
        node.target = '_blank';
        node.rel = 'noopener noreferrer';
      } else {
        node.removeAttribute('href');
      }
    });
    root.querySelectorAll('[data-luster-canva-area],[data-luster-canva-control]').forEach((node) => {
      const area = node.dataset.lusterCanvaArea
        ? source.canva?.areas.find(area => area.id === node.dataset.lusterCanvaArea)
        : source.canva?.controls?.find(control => control.id === node.dataset.lusterCanvaControl);
      if (node.dataset.lusterCanvaArea) {
        node.hidden = true;
      }
      if (area?.action.type === 'manual_link') {
        // Owner links have a server-normalized destination. Revalidate the
        // scheme here; model/worker updates still cannot create navigation.
        const href = area.action.href;
        let safe = false;
        if (typeof href === 'string' && href.length <= 2048 && ![...href].some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) {
          if (/^#[a-z][\w-]{0,70}$/i.test(href)) {
            safe = Boolean(root.querySelector(href));
          } else if (/^(?:tel|sms):\+?\d{7,15}$/.test(href)) {
            safe = true;
          } else if (href.startsWith('mailto:')) {
            const [address, query, extra] = href.slice(7).split('?');
            const params = new URLSearchParams(query);
            const subject = params.get('subject');
            safe = Boolean(emailHref(address)) && extra === undefined && (query === undefined || ([...params.keys()].every(key => key === 'subject') && params.getAll('subject').length === 1 && subject && subject.length <= 200 && ![...subject].some(character => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)));
          } else {
            try {
              const url = new URL(href);
              safe = url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && url.hostname.includes('.') && !/^[\d.]+$|:|(?:^|\.)(?:localhost|local|internal|test)$/i.test(url.hostname) && !/^\/(?:admin|api)(?:\/|$)/i.test(url.pathname);
            } catch { /* invalid links stay inert */ }
          }
        }
        if (safe) {
          node.href = href;
          if (href.startsWith('https:')) {
            node.target = '_blank';
            node.rel = 'noopener noreferrer';
          }
        } else {
          node.removeAttribute('href');
        }
      }
      if (area?.action.type === 'service') {
        const id = payload.serviceKeys?.[area.action.serviceKey];
        if (id && data.services.some(service => service.id === id)) {
          node.dataset.lusterBook = id;
        } else {
          node.disabled = true;
          node.removeAttribute('data-luster-book');
        }
      }
      if (area?.action.type === 'website') {
        try {
          const url = new URL(area.action.url);
          if (url.protocol === 'https:' && !url.username && !url.password) {
            node.href = url.href;
            node.target = '_blank';
            node.rel = 'noopener noreferrer';
          }
        } catch { /* invalid links stay inert */ }
      }
    });
    root.querySelectorAll('img').forEach((node) => {
      if (node.hasAttribute('data-luster-native-image')) {
        const id = node.dataset.lusterNativeImage;
        if (typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id)) {
          nativeImages.set(id, [...(nativeImages.get(id) ?? []), node]);
          node.addEventListener('load', () => photoStatus(node, false));
          node.addEventListener('error', () => {
            photoStatus(node, true);
            send({ type: 'native-image-error', mediaId: id });
          });
        }
        return;
      }
      const page = node.closest('.canva-page');
      const toggle = loaded => page?.querySelectorAll('[data-luster-canva-area]').forEach((area) => {
        area.hidden = !loaded;
      });
      node.addEventListener('load', () => toggle(node.naturalWidth > 0));
      node.addEventListener('error', () => toggle(false));
      const image = images[node.getAttribute('src')?.replace(/^asset:/, '')];
      if (typeof image === 'string' && /^data:image\/(?:webp|png|jpeg);base64,/.test(image)) {
        node.src = image;
        if (node.complete && node.naturalWidth > 0) {
          toggle(true);
        }
      } else {
        node.removeAttribute('src');
      }
    });
    function requestPhoto(node) {
      visiblePhotos.add(node);
      const id = node.dataset.lusterNativeImage;
      if (!node.hasAttribute('src') && !pendingPhotos.has(id)) {
        pendingPhotos.add(id);
        send({ type: 'native-image-request', mediaId: id });
      }
    }
    if (typeof IntersectionObserver === 'function') {
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            requestPhoto(entry.target);
          } else {
            visiblePhotos.delete(entry.target);
            // Keep intrinsic width/height so unloading offscreen data never
            // collapses the layout. The parent retains only a bounded LRU.
            entry.target.removeAttribute('src');
          }
        }
      }, { rootMargin: '600px' });
      for (const nodes of nativeImages.values()) {
        nodes.forEach(node => observer.observe(node));
      }
      addEventListener('pagehide', () => observer.disconnect());
    } else {
      for (const nodes of nativeImages.values()) {
        nodes.forEach(requestPhoto);
      }
    }
    root.addEventListener('click', (event) => {
      if (!event.isTrusted) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-luster-canva-area][hidden]')) {
        return;
      }
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
      const control = target?.closest('button[id],a[id],summary[id],[role="button"][id]') ?? target?.closest('[id]');
      if (control && root.contains(control)) {
        worker?.postMessage({ type: 'click', id: control.id, width: innerWidth });
      }
    });
    if (source.javascript) {
      // No navigation API or document in the worker. Browser CSP blocks network
      // and imports. Nested workers are removed before untrusted code runs.
      const workerSource = `'use strict';\nconst send = self.postMessage.bind(self);\nconst handlers = [];\nObject.defineProperty(self, 'Worker', {value:undefined,writable:false,configurable:false});\nObject.defineProperty(self, 'SharedWorker', {value:undefined,writable:false,configurable:false});\nObject.defineProperty(self, 'BroadcastChannel', {value:undefined,writable:false,configurable:false});\nconst Luster = Object.freeze({data:${JSON.stringify(data)},on: fn=>{if(typeof fn==='function' && handlers.length<20)handlers.push(fn)},update: op=>send({type:'update',op})});\nsetInterval(()=>send({type:'heartbeat'}),200);\nself.addEventListener('message',event=>{for(const handler of handlers)handler(event.data)});\n${source.javascript}`;
      // HTTPS WebKit cannot reliably load blob:null workers from an opaque
      // sandbox. A data worker retains an opaque origin and inherits the same
      // network-denying CSP without granting allow-same-origin. Encode UTF-8
      // explicitly (including non-ASCII source) and bound spread arguments.
      const bytes = new TextEncoder().encode(workerSource);
      let binary = '';
      for (let start = 0; start < bytes.length; start += 8192) {
        binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
      }
      worker = new Worker(`data:application/javascript;base64,${btoa(binary)}`);
      let heartbeat = Date.now();
      let count = 0;
      const watchdog = setInterval(() => {
        count = 0;
        if (Date.now() - heartbeat > 1500) {
          worker.terminate();
          clearInterval(watchdog);
          send({ type: 'interaction-stopped', reason: 'watchdog' });
        }
      }, 500);
      worker.onmessage = ({ data: message }) => {
        if (message?.type === 'heartbeat') {
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
          if (typeof op.className === 'string') {
            if (typeof op.enabled === 'boolean' && /^[a-z][\w-]{0,70}$/i.test(op.className)) {
              // Keep the existing explicit single-class toggle contract.
              node.classList.toggle(op.className, op.enabled);
            } else if (op.enabled === undefined && op.className.length <= 800) {
              // Generated controllers also assign complete class lists. Accept
              // bounded plain tokens only; no attributes, IDs or CSS injection.
              const classes = op.className.trim() ? op.className.trim().split(/\s+/) : [];
              if (classes.length <= 12 && classes.every(name => /^[a-z][\w-]{0,70}$/i.test(name))) {
                node.setAttribute('class', [...new Set(classes)].join(' '));
              }
            }
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
        clearInterval(watchdog);
        send({ type: 'interaction-stopped', reason: 'error' });
      };
    }
    addEventListener('resize', () => worker?.postMessage({ type: 'resize', id: '', width: innerWidth }));
    send({ type: 'rendered' });
  });
  const ready = setInterval(() => {
    if (initialized) {
      clearInterval(ready);
    } else {
      parent.postMessage({ type: 'renderer-ready', capabilities: ['native-images-v1'] }, PARENT_ORIGIN);
    }
  }, 250);
  parent.postMessage({ type: 'renderer-ready', capabilities: ['native-images-v1'] }, PARENT_ORIGIN);
})();
