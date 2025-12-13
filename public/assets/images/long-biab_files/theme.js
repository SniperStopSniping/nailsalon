/*
@license
  Expanse by Archetype Themes (https://archetypethemes.co)
  Access unminified JS in assets/theme.js

  Use this event listener to run your own JS outside of this file.
  Documentation - https://archetypethemes.co/blogs/expanse/javascript-events-for-developers

  document.addEventListener('page:loaded', function() {
    // Page has loaded and theme assets are ready
  });
*/window.theme = window.theme || {}, window.Shopify = window.Shopify || {}, theme.config = { bpSmall: !1, hasSessionStorage: !0, hasLocalStorage: !0, mediaQuerySmall: 'screen and (max-width: 769px)', youTubeReady: !1, vimeoReady: !1, vimeoLoading: !1, isTouch: !!('ontouchstart' in window || window.DocumentTouch && window.document instanceof DocumentTouch || window.navigator.maxTouchPoints || window.navigator.msMaxTouchPoints), stickyHeader: !1, rtl: document.documentElement.getAttribute('dir') == 'rtl' }, theme.recentlyViewedIds = [], theme.config.isTouch && (document.documentElement.className += ' supports-touch'), console && console.log && console.log(`Expanse theme (${theme.settings.themeVersion}) by ARCH\u039ETYPE | Learn more at https://archetypethemes.co`), window.lazySizesConfig = window.lazySizesConfig || {}, lazySizesConfig.expFactor = 4, (function () {
  'use strict'; theme.delegate = { on(event, callback, options) {
    return this.namespaces || (this.namespaces = {}), this.namespaces[event] = callback, options = options || !1, this.addEventListener(event.split('.')[0], callback, options), this;
  }, off(event) {
    if (this.namespaces) {
      return this.removeEventListener(event.split('.')[0], this.namespaces[event]), delete this.namespaces[event], this;
    }
  } }, window.on = Element.prototype.on = theme.delegate.on, window.off = Element.prototype.off = theme.delegate.off, theme.utils = { defaultTo(value, defaultValue) {
    return value == null || value !== value ? defaultValue : value;
  }, wrap(el, wrapper) {
    el.parentNode.insertBefore(wrapper, el), wrapper.appendChild(el);
  }, debounce(wait, callback, immediate) {
    let timeout; return function () {
      const context = this; const args = arguments; const later = function () {
        timeout = null, immediate || callback.apply(context, args);
      }; const callNow = immediate && !timeout; clearTimeout(timeout), timeout = setTimeout(later, wait), callNow && callback.apply(context, args);
    };
  }, throttle(limit, callback) {
    let waiting = !1; return function () {
      waiting || (callback.apply(this, arguments), waiting = !0, setTimeout(() => {
        waiting = !1;
      }, limit));
    };
  }, prepareTransition(el, callback) {
    el.addEventListener('transitionend', removeClass); function removeClass(evt) {
      el.classList.remove('is-transitioning'), el.removeEventListener('transitionend', removeClass);
    }el.classList.add('is-transitioning'), el.offsetWidth, typeof callback == 'function' && callback();
  }, compact(array) {
    for (var index = -1, length = array == null ? 0 : array.length, resIndex = 0, result = []; ++index < length;) {
      const value = array[index]; value && (result[resIndex++] = value);
    } return result;
  }, serialize(form) {
    const arr = []; return Array.prototype.slice.call(form.elements).forEach((field) => {
      if (!(!field.name || field.disabled || ['file', 'reset', 'submit', 'button'].includes(field.type))) {
        if (field.type === 'select-multiple') {
          Array.prototype.slice.call(field.options).forEach((option) => {
            option.selected && arr.push(`${encodeURIComponent(field.name)}=${encodeURIComponent(option.value)}`);
          }); return;
        }['checkbox', 'radio'].includes(field.type) && !field.checked || arr.push(`${encodeURIComponent(field.name)}=${encodeURIComponent(field.value)}`);
      }
    }), arr.join('&');
  } }, theme.a11y = { trapFocus(options) {
    const eventsName = { focusin: options.namespace ? `focusin.${options.namespace}` : 'focusin', focusout: options.namespace ? `focusout.${options.namespace}` : 'focusout', keydown: options.namespace ? `keydown.${options.namespace}` : 'keydown.handleFocus' }; const focusableEls = options.container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex^="-"])'); const elArray = [].slice.call(focusableEls); const focusableElements = elArray.filter(el => el.offsetParent !== null); const firstFocusable = focusableElements[0]; const lastFocusable = focusableElements[focusableElements.length - 1]; options.elementToFocus || (options.elementToFocus = options.container), options.container.setAttribute('tabindex', '-1'), options.elementToFocus.focus(), document.documentElement.off('focusin'), document.documentElement.on(eventsName.focusout, () => {
      document.documentElement.off(eventsName.keydown);
    }), document.documentElement.on(eventsName.focusin, (evt) => {
      evt.target !== lastFocusable && evt.target !== firstFocusable || document.documentElement.on(eventsName.keydown, (evt2) => {
        _manageFocus(evt2);
      });
    }); function _manageFocus(evt) {
      evt.keyCode === 9 && evt.target === firstFocusable && evt.shiftKey && (evt.preventDefault(), lastFocusable.focus());
    }
  }, removeTrapFocus(options) {
    const eventName = options.namespace ? `focusin.${options.namespace}` : 'focusin'; options.container && options.container.removeAttribute('tabindex'), document.documentElement.off(eventName);
  }, lockMobileScrolling(namespace, element) {
    const el = element || document.documentElement; document.documentElement.classList.add('lock-scroll'), el.on(`touchmove${namespace}`, () => {
      return !0;
    });
  }, unlockMobileScrolling(namespace, element) {
    document.documentElement.classList.remove('lock-scroll'); const el = element || document.documentElement; el.off(`touchmove${namespace}`);
  } }, document.documentElement.on('keyup.tab', (evt) => {
    evt.keyCode === 9 && (document.documentElement.classList.add('tab-outline'), document.documentElement.off('keyup.tab'));
  }), theme.Currency = (function () {
    const moneyFormat = '${{amount}}'; const superScript = theme && theme.settings && theme.settings.superScriptPrice; function formatMoney(cents, format) {
      format || (format = theme.settings.moneyFormat), typeof cents == 'string' && (cents = cents.replace('.', '')); let value = ''; const placeholderRegex = /\{\{\s*(\w+)\s*\}\}/; const formatString = format || moneyFormat; function formatWithDelimiters(number, precision, thousands, decimal) {
        if (precision = theme.utils.defaultTo(precision, 2), thousands = theme.utils.defaultTo(thousands, ','), decimal = theme.utils.defaultTo(decimal, '.'), isNaN(number) || number == null) {
          return 0;
        } number = (number / 100).toFixed(precision); const parts = number.split('.'); const dollarsAmount = parts[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, `$1${thousands}`); const centsAmount = parts[1] ? decimal + parts[1] : ''; return dollarsAmount + centsAmount;
      } switch (formatString.match(placeholderRegex)[1]) {
        case 'amount':value = formatWithDelimiters(cents, 2), superScript && value && value.includes('.') && (value = `${value.replace('.', '<sup>')}</sup>`); break; case 'amount_no_decimals':value = formatWithDelimiters(cents, 0); break; case 'amount_with_comma_separator':value = formatWithDelimiters(cents, 2, '.', ','), superScript && value && value.includes('.') && (value = `${value.replace(',', '<sup>')}</sup>`); break; case 'amount_no_decimals_with_comma_separator':value = formatWithDelimiters(cents, 0, '.', ','); break; case 'amount_no_decimals_with_space_separator':value = formatWithDelimiters(cents, 0, ' '); break;
      } return formatString.replace(placeholderRegex, value);
    } function getBaseUnit(variant) {
      if (variant && !(!variant.unit_price_measurement || !variant.unit_price_measurement.reference_value)) {
        return variant.unit_price_measurement.reference_value === 1 ? variant.unit_price_measurement.reference_unit : variant.unit_price_measurement.reference_value + variant.unit_price_measurement.reference_unit;
      }
    } return { formatMoney, getBaseUnit };
  }()), theme.Images = (function () {
    function imageSize(src) {
      if (!src) {
        return '620x';
      } const match = src.match(/.+_(pico|icon|thumb|small|compact|medium|large|grande|\d{1,4}x\d{0,4}|x\d{1,4})[_.@]/); return match !== null ? match[1] : null;
    } function getSizedImageUrl(src, size) {
      if (!src || size == null) {
        return src;
      } if (size === 'master') {
        return this.removeProtocol(src);
      } const match = src.match(/\.(jpg|jpeg|gif|png|bmp|bitmap|tiff|tif)(\?v=\d+)?$/i); if (match != null) {
        const prefix = src.split(match[0]); const suffix = match[0]; return this.removeProtocol(`${prefix[0]}_${size}${suffix}`);
      } return null;
    } function removeProtocol(path) {
      return path.replace(/http(s)?:/, '');
    } function lazyloadImagePath(string) {
      let image; return string !== null && (image = string.replace(/(\.[^.]*)$/, '_{width}x$1')), image;
    } return { imageSize, getSizedImageUrl, removeProtocol, lazyloadImagePath };
  }()), theme.loadImageSection = function (container) {
    function setAsLoaded() {
      container.classList.remove('loading', 'loading--delayed'), container.classList.add('loaded');
    } function checkForLazyloadedImage() {
      return container.querySelector('.lazyloaded');
    } if (container.querySelector('svg')) {
      setAsLoaded(); return;
    } if (checkForLazyloadedImage()) {
      setAsLoaded(); return;
    } var interval = setInterval(() => {
      checkForLazyloadedImage() && (clearInterval(interval), setAsLoaded());
    }, 25);
  }, theme.initWhenVisible = function (options) {
    const threshold = options.threshold ? options.threshold : 0; const observer = new IntersectionObserver((entries, observer2) => {
      entries.forEach((entry) => {
        entry.isIntersecting && typeof options.callback == 'function' && (options.callback(), observer2.unobserve(entry.target));
      });
    }, { rootMargin: `0px 0px ${threshold}px 0px` }); observer.observe(options.element);
  }, theme.LibraryLoader = (function () {
    const types = { link: 'link', script: 'script' }; const status = { requested: 'requested', loaded: 'loaded' }; const cloudCdn = 'https://cdn.shopify.com/shopifycloud/'; const libraries = { youtubeSdk: { tagId: 'youtube-sdk', src: 'https://www.youtube.com/iframe_api', type: types.script }, vimeo: { tagId: 'vimeo-api', src: 'https://player.vimeo.com/api/player.js', type: types.script }, shopifyXr: { tagId: 'shopify-model-viewer-xr', src: `${cloudCdn}shopify-xr-js/assets/v1.0/shopify-xr.en.js`, type: types.script }, modelViewerUi: { tagId: 'shopify-model-viewer-ui', src: `${cloudCdn}model-viewer-ui/assets/v1.0/model-viewer-ui.en.js`, type: types.script }, modelViewerUiStyles: { tagId: 'shopify-model-viewer-ui-styles', src: `${cloudCdn}model-viewer-ui/assets/v1.0/model-viewer-ui.css`, type: types.link } }; function load(libraryName, callback) {
      const library = libraries[libraryName]; if (library && library.status !== status.requested) {
        if (callback = callback || function () {}, library.status === status.loaded) {
          callback(); return;
        }library.status = status.requested; let tag; switch (library.type) {
          case types.script:tag = createScriptTag(library, callback); break; case types.link:tag = createLinkTag(library, callback); break;
        }tag.id = library.tagId, library.element = tag; const firstScriptTag = document.getElementsByTagName(library.type)[0]; firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
      }
    } function createScriptTag(library, callback) {
      const tag = document.createElement('script'); return tag.src = library.src, tag.addEventListener('load', () => {
        library.status = status.loaded, callback();
      }), tag;
    } function createLinkTag(library, callback) {
      const tag = document.createElement('link'); return tag.href = library.src, tag.rel = 'stylesheet', tag.type = 'text/css', tag.addEventListener('load', () => {
        library.status = status.loaded, callback();
      }), tag;
    } return { load };
  }()), theme.rteInit = function () {
    document.querySelectorAll('.rte table').forEach((table) => {
      const wrapWith = document.createElement('div'); wrapWith.classList.add('table-wrapper'), theme.utils.wrap(table, wrapWith);
    }), document.querySelectorAll('.rte iframe[src*="youtube.com/embed"]').forEach((iframe) => {
      wrapVideo(iframe);
    }), document.querySelectorAll('.rte iframe[src*="player.vimeo"]').forEach((iframe) => {
      wrapVideo(iframe);
    }); function wrapVideo(iframe) {
      iframe.src = iframe.src; const wrapWith = document.createElement('div'); wrapWith.classList.add('video-wrapper'), theme.utils.wrap(iframe, wrapWith);
    }document.querySelectorAll('.rte a img').forEach((img) => {
      img.parentNode.classList.add('rte__image');
    });
  }, theme.Sections = function () {
    this.constructors = {}, this.instances = [], document.addEventListener('shopify:section:load', this._onSectionLoad.bind(this)), document.addEventListener('shopify:section:unload', this._onSectionUnload.bind(this)), document.addEventListener('shopify:section:select', this._onSelect.bind(this)), document.addEventListener('shopify:section:deselect', this._onDeselect.bind(this)), document.addEventListener('shopify:block:select', this._onBlockSelect.bind(this)), document.addEventListener('shopify:block:deselect', this._onBlockDeselect.bind(this));
  }, theme.Sections.prototype = Object.assign({}, theme.Sections.prototype, { _createInstance(container, constructor, scope) {
    const id = container.getAttribute('data-section-id'); const type = container.getAttribute('data-section-type'); if (constructor = constructor || this.constructors[type], !(typeof constructor > 'u')) {
      if (scope) {
        const instanceExists = this._findInstance(id); instanceExists && this._removeInstance(id);
      } try {
        const instance = Object.assign(new constructor(container), { id, type, container }); this.instances.push(instance);
      } catch (e) {
        console.error(e);
      }
    }
  }, _findInstance(id) {
    for (let i = 0; i < this.instances.length; i++) {
      if (this.instances[i].id === id) {
        return this.instances[i];
      }
    }
  }, _removeInstance(id) {
    for (var i = this.instances.length, instance; i--;) {
      if (this.instances[i].id === id) {
        instance = this.instances[i], this.instances.splice(i, 1); break;
      }
    } return instance;
  }, _onSectionLoad(evt, subSection, subSectionId) {
    window.AOS && AOS.refreshHard(), theme && theme.initGlobals && theme.initGlobals(); const container = subSection || evt.target; const section = subSection || evt.target.querySelector('[data-section-id]'); if (section) {
      this._createInstance(section); const instance = subSection ? subSectionId : this._findInstance(evt.detail.sectionId); const haveSubSections = container.querySelectorAll('[data-subsection]'); haveSubSections.length && this.loadSubSections(container), instance && typeof instance.onLoad == 'function' && instance.onLoad(evt), setTimeout(() => {
        window.dispatchEvent(new Event('scroll'));
      }, 200);
    }
  }, _onSectionUnload(evt) {
    this.instances = this.instances.filter((instance) => {
      const isEventInstance = instance.id === evt.detail.sectionId; return isEventInstance && typeof instance.onUnload == 'function' && instance.onUnload(evt), !isEventInstance;
    });
  }, loadSubSections(scope) {
    if (scope) {
      const sections = scope.querySelectorAll('[data-section-id]'); sections.forEach((el) => {
        this._onSectionLoad(null, el, el.dataset.sectionId);
      });
    }
  }, _onSelect(evt) {
    const instance = this._findInstance(evt.detail.sectionId); typeof instance < 'u' && typeof instance.onSelect == 'function' && instance.onSelect(evt);
  }, _onDeselect(evt) {
    const instance = this._findInstance(evt.detail.sectionId); typeof instance < 'u' && typeof instance.onDeselect == 'function' && instance.onDeselect(evt);
  }, _onBlockSelect(evt) {
    const instance = this._findInstance(evt.detail.sectionId); typeof instance < 'u' && typeof instance.onBlockSelect == 'function' && instance.onBlockSelect(evt);
  }, _onBlockDeselect(evt) {
    const instance = this._findInstance(evt.detail.sectionId); typeof instance < 'u' && typeof instance.onBlockDeselect == 'function' && instance.onBlockDeselect(evt);
  }, register(type, constructor, scope) {
    this.constructors[type] = constructor; let sections = document.querySelectorAll(`[data-section-type="${type}"]`); scope && (sections = scope.querySelectorAll(`[data-section-type="${type}"]`)), sections.forEach((container) => {
      this._createInstance(container, constructor, scope);
    });
  }, reinit(section) {
    for (let i = 0; i < this.instances.length; i++) {
      const instance = this.instances[i]; instance.type === section && typeof instance.forceReload == 'function' && instance.forceReload();
    }
  } }), theme.Variants = (function () {
    function Variants(options) {
      this.container = options.container, this.variants = options.variants, this.singleOptionSelector = options.singleOptionSelector, this.originalSelectorId = options.originalSelectorId, this.enableHistoryState = options.enableHistoryState, this.currentVariant = this._getVariantFromOptions(), this.container.querySelectorAll(this.singleOptionSelector).forEach((el) => {
        el.addEventListener('change', this._onSelectChange.bind(this));
      });
    } return Variants.prototype = Object.assign({}, Variants.prototype, { _getCurrentOptions() {
      let result = []; return this.container.querySelectorAll(this.singleOptionSelector).forEach((el) => {
        const type = el.getAttribute('type'); type === 'radio' || type === 'checkbox' ? el.checked && result.push({ value: el.value, index: el.dataset.index }) : result.push({ value: el.value, index: el.dataset.index });
      }), result = theme.utils.compact(result), result;
    }, _getVariantFromOptions() {
      const selectedValues = this._getCurrentOptions(); const variants = this.variants; let found = !1; return variants.forEach((variant) => {
        let match = !0; const options = variant.options; selectedValues.forEach((option) => {
          match && (match = variant[option.index] === option.value);
        }), match && (found = variant);
      }), found || null;
    }, _onSelectChange() {
      const variant = this._getVariantFromOptions(); this.container.dispatchEvent(new CustomEvent('variantChange', { detail: { variant } })), document.dispatchEvent(new CustomEvent('variant:change', { detail: { variant } })), variant && (this._updateMasterSelect(variant), this._updateImages(variant), this._updatePrice(variant), this._updateUnitPrice(variant), this._updateSKU(variant), this.currentVariant = variant, this.enableHistoryState && this._updateHistoryState(variant));
    }, _updateImages(variant) {
      const variantImage = variant.featured_image || {}; const currentVariantImage = this.currentVariant.featured_image || {}; !variant.featured_image || variantImage.src === currentVariantImage.src || this.container.dispatchEvent(new CustomEvent('variantImageChange', { detail: { variant } }));
    }, _updatePrice(variant) {
      variant.price === this.currentVariant.price && variant.compare_at_price === this.currentVariant.compare_at_price || this.container.dispatchEvent(new CustomEvent('variantPriceChange', { detail: { variant } }));
    }, _updateUnitPrice(variant) {
      variant.unit_price !== this.currentVariant.unit_price && this.container.dispatchEvent(new CustomEvent('variantUnitPriceChange', { detail: { variant } }));
    }, _updateSKU(variant) {
      variant.sku !== this.currentVariant.sku && this.container.dispatchEvent(new CustomEvent('variantSKUChange', { detail: { variant } }));
    }, _updateHistoryState(variant) {
      if (!(!history.replaceState || !variant)) {
        const newurl = `${window.location.protocol}//${window.location.host}${window.location.pathname}?variant=${variant.id}`; window.history.replaceState({ path: newurl }, '', newurl);
      }
    }, _updateMasterSelect(variant) {
      this.container.querySelector(this.originalSelectorId).value = variant.id, this.container.querySelector(this.originalSelectorId).dispatchEvent(new Event('change', { bubbles: !0 }));
    } }), Variants;
  }()), window.vimeoApiReady = function () {
    theme.config.vimeoLoading = !0, checkIfVimeoIsReady().then(() => {
      theme.config.vimeoReady = !0, theme.config.vimeoLoading = !1, document.dispatchEvent(new CustomEvent('vimeoReady'));
    });
  }; function checkIfVimeoIsReady() {
    let wait; let timeout; const deferred = new Promise((resolve, reject) => {
      wait = setInterval(() => {
        Vimeo && (clearInterval(wait), clearTimeout(timeout), resolve());
      }, 500), timeout = setTimeout(() => {
        clearInterval(wait), reject();
      }, 4e3);
    }); return deferred;
  } if (theme.VimeoPlayer = (function () {
    const classes = { loading: 'loading', loaded: 'loaded', interactable: 'video-interactable' }; const defaults = { background: !0, byline: !1, controls: !1, loop: !0, muted: !0, playsinline: !0, portrait: !1, title: !1 }; function VimeoPlayer(divId, videoId, options) {
      this.divId = divId, this.el = document.getElementById(divId), this.videoId = videoId, this.iframe = null, this.options = options, this.options && this.options.videoParent && (this.parent = this.el.closest(this.options.videoParent)), this.setAsLoading(), theme.config.vimeoReady ? this.init() : (theme.LibraryLoader.load('vimeo', window.vimeoApiReady), document.addEventListener('vimeoReady', this.init.bind(this)));
    } return VimeoPlayer.prototype = Object.assign({}, VimeoPlayer.prototype, { init() {
      const args = defaults; args.id = this.videoId, this.videoPlayer = new Vimeo.Player(this.el, args), this.videoPlayer.ready().then(this.playerReady.bind(this));
    }, playerReady() {
      this.iframe = this.el.querySelector('iframe'), this.iframe.setAttribute('tabindex', '-1'), this.videoPlayer.setMuted(!0), this.setAsLoaded(); const observer = new IntersectionObserver((entries, observer2) => {
        entries.forEach((entry) => {
          entry.isIntersecting ? this.play() : this.pause();
        });
      }, { rootMargin: '0px 0px 50px 0px' }); observer.observe(this.iframe);
    }, setAsLoading() {
      this.parent && this.parent.classList.add(classes.loading);
    }, setAsLoaded() {
      this.parent && (this.parent.classList.remove(classes.loading), this.parent.classList.add(classes.loaded), Shopify && Shopify.designMode && window.AOS && AOS.refreshHard());
    }, enableInteraction() {
      this.parent && this.parent.classList.add(classes.interactable);
    }, play() {
      this.videoPlayer && typeof this.videoPlayer.play == 'function' && this.videoPlayer.play();
    }, pause() {
      this.videoPlayer && typeof this.videoPlayer.pause == 'function' && this.videoPlayer.pause();
    }, destroy() {
      this.videoPlayer && typeof this.videoPlayer.destroy == 'function' && this.videoPlayer.destroy();
    } }), VimeoPlayer;
  }()), window.onYouTubeIframeAPIReady = function () {
    theme.config.youTubeReady = !0, document.dispatchEvent(new CustomEvent('youTubeReady'));
  }, theme.YouTube = (function () {
    const classes = { loading: 'loading', loaded: 'loaded', interactable: 'video-interactable' }; const defaults = { width: 1280, height: 720, playerVars: { autohide: 0, autoplay: 1, cc_load_policy: 0, controls: 0, fs: 0, iv_load_policy: 3, modestbranding: 1, playsinline: 1, rel: 0 } }; function YouTube(divId, options) {
      this.divId = divId, this.iframe = null, this.attemptedToPlay = !1, defaults.events = { onReady: this.onVideoPlayerReady.bind(this), onStateChange: this.onVideoStateChange.bind(this) }, this.options = Object.assign({}, defaults, options), this.options && (this.options.videoParent && (this.parent = document.getElementById(this.divId).closest(this.options.videoParent)), this.options.autoplay || (this.options.playerVars.autoplay = this.options.autoplay), this.options.style === 'sound' && (this.options.playerVars.controls = 1, this.options.playerVars.autoplay = 0)), this.setAsLoading(), theme.config.youTubeReady ? this.init() : (theme.LibraryLoader.load('youtubeSdk'), document.addEventListener('youTubeReady', this.init.bind(this)));
    } return YouTube.prototype = Object.assign({}, YouTube.prototype, { init() {
      this.videoPlayer = new YT.Player(this.divId, this.options);
    }, onVideoPlayerReady(evt) {
      this.iframe = document.getElementById(this.divId), this.iframe.setAttribute('tabindex', '-1'), this.options.style !== 'sound' && evt.target.mute(); const observer = new IntersectionObserver((entries, observer2) => {
        entries.forEach((entry) => {
          entry.isIntersecting ? this.play() : this.pause();
        });
      }, { rootMargin: '0px 0px 50px 0px' }); observer.observe(this.iframe);
    }, onVideoStateChange(evt) {
      switch (evt.data) {
        case -1:this.attemptedToPlay && (this.setAsLoaded(), this.enableInteraction()); break; case 0:this.play(evt); break; case 1:this.setAsLoaded(); break; case 3:this.attemptedToPlay = !0; break;
      }
    }, setAsLoading() {
      this.parent && this.parent.classList.add(classes.loading);
    }, setAsLoaded() {
      this.parent && (this.parent.classList.remove(classes.loading), this.parent.classList.add(classes.loaded), Shopify && Shopify.designMode && window.AOS && AOS.refreshHard());
    }, enableInteraction() {
      this.parent && this.parent.classList.add(classes.interactable);
    }, play() {
      this.videoPlayer && typeof this.videoPlayer.playVideo == 'function' && this.videoPlayer.playVideo();
    }, pause() {
      this.videoPlayer && typeof this.videoPlayer.pauseVideo == 'function' && this.videoPlayer.pauseVideo();
    }, destroy() {
      this.videoPlayer && typeof this.videoPlayer.destroy == 'function' && this.videoPlayer.destroy();
    } }), YouTube;
  }()), (function () {
    const originalResizeMethod = Flickity.prototype.resize; let lastWidth = window.innerWidth; Flickity.prototype.resize = function () {
      window.innerWidth !== lastWidth && (lastWidth = window.innerWidth, originalResizeMethod.apply(this, arguments));
    };
  }()), (function () {
    let e = !1; let t; document.body.addEventListener('touchstart', (i) => {
      if (!i.target.closest('.flickity-slider')) {
        return e = !1;
      } e = !0, t = { x: i.touches[0].pageX, y: i.touches[0].pageY };
    }), document.body.addEventListener('touchmove', (i) => {
      if (e && i.cancelable) {
        const n = { x: i.touches[0].pageX - t.x, y: i.touches[0].pageY - t.y }; Math.abs(n.x) > Flickity.defaults.dragThreshold && i.preventDefault();
      }
    }, { passive: !1 });
  }()), theme.AjaxRenderer = (function () {
    function AjaxRenderer({ sections, preserveParams, onReplace, debug } = {}) {
      this.sections = sections || [], this.preserveParams = preserveParams || [], this.cachedSections = [], this.onReplace = onReplace, this.debug = !!debug;
    } return AjaxRenderer.prototype = Object.assign({}, AjaxRenderer.prototype, { renderPage(basePath, searchParams, updateURLHash = !0) {
      searchParams && this.appendPreservedParams(searchParams); const sectionRenders = this.sections.map((section) => {
        const url = `${basePath}?section_id=${section.sectionId}&${searchParams}`; const cachedSectionUrl = cachedSection => cachedSection.url === url; return this.cachedSections.some(cachedSectionUrl) ? this.renderSectionFromCache(cachedSectionUrl, section) : this.renderSectionFromFetch(url, section);
      }); return updateURLHash && this.updateURLHash(searchParams), Promise.all(sectionRenders);
    }, renderSectionFromCache(url, section) {
      const cachedSection = this.cachedSections.find(url); return this.log(`[AjaxRenderer] rendering from cache: url=${cachedSection.url}`), this.renderSection(cachedSection.html, section), Promise.resolve(section);
    }, renderSectionFromFetch(url, section) {
      return this.log(`[AjaxRenderer] redering from fetch: url=${url}`), new Promise((resolve, reject) => {
        fetch(url).then(response => response.text()).then((responseText) => {
          const html = responseText; this.cachedSections = [...this.cachedSections, { html, url }], this.renderSection(html, section), resolve(section);
        }).catch(err => reject(err));
      });
    }, renderSection(html, section) {
      this.log(`[AjaxRenderer] rendering section: section=${JSON.stringify(section)}`); const newDom = new DOMParser().parseFromString(html, 'text/html'); if (this.onReplace) {
        this.onReplace(newDom, section);
      } else if (typeof section.nodeId == 'string') {
        const newContentEl = newDom.getElementById(section.nodeId); if (!newContentEl) {
          return;
        } document.getElementById(section.nodeId).innerHTML = newContentEl.innerHTML;
      } else {
        section.nodeId.forEach((id) => {
          document.getElementById(id).innerHTML = newDom.getElementById(id).innerHTML;
        });
      } return section;
    }, appendPreservedParams(searchParams) {
      this.preserveParams.forEach((paramName) => {
        const param = new URLSearchParams(window.location.search).get(paramName); param && (this.log(`[AjaxRenderer] Preserving ${paramName} param`), searchParams.append(paramName, param));
      });
    }, updateURLHash(searchParams) {
      history.pushState({}, '', `${window.location.pathname}${searchParams && '?'.concat(searchParams)}`);
    }, log(...args) {
      this.debug && console.log(...args);
    } }), AjaxRenderer;
  }()), window.Shopify && window.Shopify.theme && navigator && navigator.sendBeacon && window.Shopify.designMode && navigator.sendBeacon('https://api.archetypethemes.co/api/beacon', new URLSearchParams({ shop: window.Shopify.shop, themeName: window.Shopify.theme.name, role: window.Shopify.theme.role, route: window.location.pathname, themeId: window.Shopify.theme.id, themeStoreId: window.Shopify.theme.theme_store_id || 0, isThemeEditor: !!window.Shopify.designMode })), theme.cart = { getCart() {
    const url = ''.concat(theme.routes.cart, '?t=').concat(Date.now()); return fetch(url, { credentials: 'same-origin', method: 'GET' }).then(response => response.json());
  }, getCartProductMarkup() {
    let url = ''.concat(theme.routes.cartPage, '?t=').concat(Date.now()); return url = !url.includes('?') ? `${url}?view=ajax` : `${url}&view=ajax`, fetch(url, { credentials: 'same-origin', method: 'GET' }).then((response) => {
      return response.text();
    });
  }, changeItem(key, qty) {
    return this._updateCart({ url: ''.concat(theme.routes.cartChange, '?t=').concat(Date.now()), data: JSON.stringify({ id: key, quantity: qty }) });
  }, _updateCart(params) {
    return fetch(params.url, { method: 'POST', body: params.data, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } }).then(response => response.json()).then((cart) => {
      return cart;
    });
  }, updateAttribute(key, value) {
    return this._updateCart({ url: '/cart/update.js', data: JSON.stringify({ attributes: { [key]: theme.cart.attributeToString(value) } }) });
  }, updateNote(note) {
    return this._updateCart({ url: '/cart/update.js', data: JSON.stringify({ note: theme.cart.attributeToString(note) }) });
  }, attributeToString(attribute) {
    return typeof attribute != 'string' && (attribute += '', attribute === 'undefined' && (attribute = '')), attribute.trim();
  } }, theme.CartForm = (function () {
    const selectors = { products: '[data-products]', qtySelector: '.js-qty__wrapper', discounts: '[data-discounts]', savings: '[data-savings]', subTotal: '[data-subtotal]', cartBubble: '.cart-link__bubble', cartNote: '[name="note"]', termsCheckbox: '.cart__terms-checkbox', checkoutBtn: '.cart__checkout' }; const classes = { btnLoading: 'btn--loading' }; const config = { requiresTerms: !1 }; function CartForm(form) {
      form && (this.form = form, this.wrapper = form.parentNode, this.location = form.dataset.location, this.namespace = `.cart-${this.location}`, this.products = form.querySelector(selectors.products), this.submitBtn = form.querySelector(selectors.checkoutBtn), this.discounts = form.querySelector(selectors.discounts), this.savings = form.querySelector(selectors.savings), this.subtotal = form.querySelector(selectors.subTotal), this.termsCheckbox = form.querySelector(selectors.termsCheckbox), this.noteInput = form.querySelector(selectors.cartNote), this.termsCheckbox && (config.requiresTerms = !0), this.init());
    } return CartForm.prototype = Object.assign({}, CartForm.prototype, { init() {
      this.initQtySelectors(), document.addEventListener(`cart:quantity${this.namespace}`, this.quantityChanged.bind(this)), this.form.on(`submit${this.namespace}`, this.onSubmit.bind(this)), this.noteInput && this.noteInput.addEventListener('change', function () {
        const newNote = this.value; theme.cart.updateNote(newNote);
      }), document.addEventListener('cart:build', () => {
        this.buildCart();
      });
    }, reInit() {
      this.initQtySelectors();
    }, onSubmit(evt) {
      if (this.submitBtn.classList.add(classes.btnLoading), config.requiresTerms && !this.termsCheckbox.checked) {
        return alert(theme.strings.cartTermsConfirmation), this.submitBtn.classList.remove(classes.btnLoading), evt.preventDefault(), !1;
      }
    }, _parseProductHTML(html) {
      const parser = new DOMParser(); const doc = parser.parseFromString(html, 'text/html'); return { items: doc.querySelector('.cart__items'), discounts: doc.querySelector('.cart__discounts') };
    }, buildCart() {
      theme.cart.getCartProductMarkup().then(this.cartMarkup.bind(this));
    }, cartMarkup(html) {
      const markup = this._parseProductHTML(html); const items = markup.items; const count = Number.parseInt(items.dataset.count); const subtotal = items.dataset.cartSubtotal; const savings = items.dataset.cartSavings; this.updateCartDiscounts(markup.discounts), this.updateSavings(savings), count > 0 ? this.wrapper.classList.remove('is-empty') : this.wrapper.classList.add('is-empty'), this.updateCount(count), this.products.innerHTML = '', this.products.append(items), this.subtotal.innerHTML = theme.Currency.formatMoney(subtotal, theme.settings.moneyFormat), this.reInit(), window.AOS && AOS.refreshHard(), Shopify && Shopify.StorefrontExpressButtons && Shopify.StorefrontExpressButtons.initialize();
    }, updateCartDiscounts(markup) {
      this.discounts && (this.discounts.innerHTML = '', this.discounts.append(markup));
    }, initQtySelectors() {
      this.form.querySelectorAll(selectors.qtySelector).forEach((el) => {
        const selector = new theme.QtySelector(el, { namespace: this.namespace, isCart: !0 });
      });
    }, quantityChanged(evt) {
      const key = evt.detail[0]; const qty = evt.detail[1]; const el = evt.detail[2]; !key || !qty || (el && el.classList.add('is-loading'), theme.cart.changeItem(key, qty).then((cart) => {
        cart.item_count > 0 ? this.wrapper.classList.remove('is-empty') : this.wrapper.classList.add('is-empty'), this.buildCart(), document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart } }));
      }).catch((XMLHttpRequest) => {}));
    }, updateSubtotal(subtotal) {
      this.form.querySelector(selectors.subTotal).innerHTML = theme.Currency.formatMoney(subtotal, theme.settings.moneyFormat);
    }, updateSavings(savings) {
      if (this.savings) {
        if (savings > 0) {
          const amount = theme.Currency.formatMoney(savings, theme.settings.moneyFormat); this.savings.classList.remove('hide'), this.savings.innerHTML = theme.strings.cartSavings.replace('[savings]', amount);
        } else {
          this.savings.classList.add('hide');
        }
      }
    }, updateCount(count) {
      const countEls = document.querySelectorAll('.cart-link__bubble-num'); countEls.length && countEls.forEach((el) => {
        el.innerText = count;
      }); const bubbles = document.querySelectorAll(selectors.cartBubble); bubbles.length && (count > 0
        ? bubbles.forEach((b) => {
          b.classList.add('cart-link__bubble--visible');
        })
        : bubbles.forEach((b) => {
          b.classList.remove('cart-link__bubble--visible');
        }));
    } }), CartForm;
  }()), theme.collapsibles = (function () {
    const selectors = { trigger: '.collapsible-trigger', module: '.collapsible-content', moduleInner: '.collapsible-content__inner', tabs: '.collapsible-trigger--tab' }; const classes = { hide: 'hide', open: 'is-open', autoHeight: 'collapsible--auto-height', tabs: 'collapsible-trigger--tab' }; const namespace = '.collapsible'; let isTransitioning = !1; function init(scope) {
      const el = scope || document; el.querySelectorAll(selectors.trigger).forEach((trigger) => {
        const state = trigger.classList.contains(classes.open); trigger.setAttribute('aria-expanded', state), trigger.off(`click${namespace}`), trigger.on(`click${namespace}`, toggle);
      });
    } function toggle(evt) {
      if (!isTransitioning) {
        isTransitioning = !0; const el = evt.currentTarget; const isOpen = el.classList.contains(classes.open); const isTab = el.classList.contains(classes.tabs); let moduleId = el.getAttribute('aria-controls'); let container = document.getElementById(moduleId); if (moduleId || (moduleId = el.dataset.controls), !!moduleId) {
          if (!container) {
            const multipleMatches = document.querySelectorAll(`[data-id="${moduleId}"]`); multipleMatches.length > 0 && (container = el.parentNode.querySelector(`[data-id="${moduleId}"]`));
          } if (!container) {
            isTransitioning = !1; return;
          } let height = container.querySelector(selectors.moduleInner).offsetHeight; const isAutoHeight = container.classList.contains(classes.autoHeight); const parentCollapsibleEl = container.parentNode.closest(selectors.module); const childHeight = height; if (isTab) {
            if (isOpen) {
              isTransitioning = !1; return;
            } let newModule; document.querySelectorAll(`${selectors.tabs}[data-id="${el.dataset.id}"]`).forEach((el2) => {
              el2.classList.remove(classes.open), newModule = document.querySelector(`#${el2.getAttribute('aria-controls')}`), setTransitionHeight(newModule, 0, !0);
            });
          } if (isOpen && isAutoHeight && setTimeout(() => {
            height = 0, setTransitionHeight(container, height, isOpen, isAutoHeight);
          }, 0), isOpen && !isAutoHeight && (height = 0), el.setAttribute('aria-expanded', !isOpen), isOpen ? el.classList.remove(classes.open) : el.classList.add(classes.open), setTransitionHeight(container, height, isOpen, isAutoHeight), parentCollapsibleEl) {
            const totalHeight = isOpen ? parentCollapsibleEl.offsetHeight - childHeight : height + parentCollapsibleEl.offsetHeight; setTransitionHeight(parentCollapsibleEl, totalHeight, !1, !1);
          } if (window.SPR) {
            const btn = container.querySelector('.spr-summary-actions-newreview'); if (!btn) {
              return;
            } btn.off(`click${namespace}`), btn.on(`click${namespace}`, () => {
              height = container.querySelector(selectors.moduleInner).offsetHeight, setTransitionHeight(container, height, isOpen, isAutoHeight);
            });
          }
        }
      }
    } function setTransitionHeight(container, height, isOpen, isAutoHeight) {
      if (container.classList.remove(classes.hide), theme.utils.prepareTransition(container, () => {
        container.style.height = `${height}px`, isOpen ? container.classList.remove(classes.open) : container.classList.add(classes.open);
      }), !isOpen && isAutoHeight) {
        const o = container; window.setTimeout(() => {
          o.css('height', 'auto'), isTransitioning = !1;
        }, 500);
      } else {
        isTransitioning = !1;
      }
    } return { init };
  }()), theme.Disclosure = (function () {
    const selectors = { disclosureForm: '[data-disclosure-form]', disclosureList: '[data-disclosure-list]', disclosureToggle: '[data-disclosure-toggle]', disclosureInput: '[data-disclosure-input]', disclosureOptions: '[data-disclosure-option]' }; const classes = { listVisible: 'disclosure-list--visible' }; function Disclosure(disclosure) {
      this.container = disclosure, this._cacheSelectors(), this._setupListeners();
    } return Disclosure.prototype = Object.assign({}, Disclosure.prototype, { _cacheSelectors() {
      this.cache = { disclosureForm: this.container.closest(selectors.disclosureForm), disclosureList: this.container.querySelector(selectors.disclosureList), disclosureToggle: this.container.querySelector(selectors.disclosureToggle), disclosureInput: this.container.querySelector(selectors.disclosureInput), disclosureOptions: this.container.querySelectorAll(selectors.disclosureOptions) };
    }, _setupListeners() {
      this.eventHandlers = this._setupEventHandlers(), this.cache.disclosureToggle.addEventListener('click', this.eventHandlers.toggleList), this.cache.disclosureOptions.forEach(function (disclosureOption) {
        disclosureOption.addEventListener('click', this.eventHandlers.connectOptions);
      }, this), this.container.addEventListener('keyup', this.eventHandlers.onDisclosureKeyUp), this.cache.disclosureList.addEventListener('focusout', this.eventHandlers.onDisclosureListFocusOut), this.cache.disclosureToggle.addEventListener('focusout', this.eventHandlers.onDisclosureToggleFocusOut), document.body.addEventListener('click', this.eventHandlers.onBodyClick);
    }, _setupEventHandlers() {
      return { connectOptions: this._connectOptions.bind(this), toggleList: this._toggleList.bind(this), onBodyClick: this._onBodyClick.bind(this), onDisclosureKeyUp: this._onDisclosureKeyUp.bind(this), onDisclosureListFocusOut: this._onDisclosureListFocusOut.bind(this), onDisclosureToggleFocusOut: this._onDisclosureToggleFocusOut.bind(this) };
    }, _connectOptions(event) {
      event.preventDefault(), this._submitForm(event.currentTarget.dataset.value);
    }, _onDisclosureToggleFocusOut(event) {
      const disclosureLostFocus = this.container.contains(event.relatedTarget) === !1; disclosureLostFocus && this._hideList();
    }, _onDisclosureListFocusOut(event) {
      const childInFocus = event.currentTarget.contains(event.relatedTarget); const isVisible = this.cache.disclosureList.classList.contains(classes.listVisible); isVisible && !childInFocus && this._hideList();
    }, _onDisclosureKeyUp(event) {
      event.which === 27 && (this._hideList(), this.cache.disclosureToggle.focus());
    }, _onBodyClick(event) {
      const isOption = this.container.contains(event.target); const isVisible = this.cache.disclosureList.classList.contains(classes.listVisible); isVisible && !isOption && this._hideList();
    }, _submitForm(value) {
      this.cache.disclosureInput.value = value, this.cache.disclosureForm.submit();
    }, _hideList() {
      this.cache.disclosureList.classList.remove(classes.listVisible), this.cache.disclosureToggle.setAttribute('aria-expanded', !1);
    }, _toggleList() {
      const ariaExpanded = this.cache.disclosureToggle.getAttribute('aria-expanded') === 'true'; this.cache.disclosureList.classList.toggle(classes.listVisible), this.cache.disclosureToggle.setAttribute('aria-expanded', !ariaExpanded);
    }, destroy() {
      this.cache.disclosureToggle.removeEventListener('click', this.eventHandlers.toggleList), this.cache.disclosureOptions.forEach(function (disclosureOption) {
        disclosureOption.removeEventListener('click', this.eventHandlers.connectOptions);
      }, this), this.container.removeEventListener('keyup', this.eventHandlers.onDisclosureKeyUp), this.cache.disclosureList.removeEventListener('focusout', this.eventHandlers.onDisclosureListFocusOut), this.cache.disclosureToggle.removeEventListener('focusout', this.eventHandlers.onDisclosureToggleFocusOut), document.body.removeEventListener('click', this.eventHandlers.onBodyClick);
    } }), Disclosure;
  }()), theme.Modals = (function () {
    function Modal(id, name, options) {
      const defaults = { close: '.js-modal-close', open: `.js-modal-open-${name}`, openClass: 'modal--is-active', closingClass: 'modal--is-closing', bodyOpenClass: ['modal-open'], bodyOpenSolidClass: 'modal-open--solid', bodyClosingClass: 'modal-closing', closeOffContentClick: !0 }; if (this.id = id, this.modal = document.getElementById(id), !this.modal) {
        return !1;
      } this.modalContent = this.modal.querySelector('.modal__inner'), this.config = Object.assign(defaults, options), this.modalIsOpen = !1, this.focusOnOpen = this.config.focusIdOnOpen ? document.getElementById(this.config.focusIdOnOpen) : this.modal, this.isSolid = this.config.solid, this.init();
    } return Modal.prototype.init = function () {
      document.querySelectorAll(this.config.open).forEach((btn) => {
        btn.setAttribute('aria-expanded', 'false'), btn.addEventListener('click', this.open.bind(this));
      }), this.modal.querySelectorAll(this.config.close).forEach((btn) => {
        btn.addEventListener('click', this.close.bind(this));
      }), document.addEventListener('drawerOpen', () => {
        this.close();
      });
    }, Modal.prototype.open = function (evt) {
      let externalCall = !1; this.modalIsOpen || (evt ? evt.preventDefault() : externalCall = !0, evt && evt.stopPropagation && (evt.stopPropagation(), this.activeSource = evt.currentTarget.setAttribute('aria-expanded', 'true')), this.modalIsOpen && !externalCall && this.close(), this.modal.classList.add(this.config.openClass), document.documentElement.classList.add(...this.config.bodyOpenClass), this.isSolid && document.documentElement.classList.add(this.config.bodyOpenSolidClass), this.modalIsOpen = !0, theme.a11y.trapFocus({ container: this.modal, elementToFocus: this.focusOnOpen, namespace: 'modal_focus' }), document.dispatchEvent(new CustomEvent('modalOpen')), document.dispatchEvent(new CustomEvent(`modalOpen.${this.id}`)), this.bindEvents());
    }, Modal.prototype.close = function (evt) {
      if (this.modalIsOpen) {
        if (evt && !evt.target.closest('.js-modal-close')) {
          if (evt.target.closest('.modal__inner')) {
            return;
          }
        }document.activeElement.blur(), this.modal.classList.remove(this.config.openClass), this.modal.classList.add(this.config.closingClass), document.documentElement.classList.remove(...this.config.bodyOpenClass), document.documentElement.classList.add(this.config.bodyClosingClass), window.setTimeout(() => {
          document.documentElement.classList.remove(this.config.bodyClosingClass), this.modal.classList.remove(this.config.closingClass), this.activeSource && this.activeSource.getAttribute('aria-expanded') && this.activeSource.setAttribute('aria-expanded', 'false').focus();
        }, 500), this.isSolid && document.documentElement.classList.remove(this.config.bodyOpenSolidClass), this.modalIsOpen = !1, theme.a11y.removeTrapFocus({ container: this.modal, namespace: 'modal_focus' }), document.dispatchEvent(new CustomEvent(`modalClose.${this.id}`)), this.unbindEvents();
      }
    }, Modal.prototype.bindEvents = function () {
      window.on('keyup.modal', (evt) => {
        evt.keyCode === 27 && this.close();
      }), this.config.closeOffContentClick && this.modal.on('click.modal', this.close.bind(this));
    }, Modal.prototype.unbindEvents = function () {
      document.documentElement.off('.modal'), this.config.closeOffContentClick && this.modal.off('.modal');
    }, Modal;
  }()), window.onpageshow = function (evt) {
    evt.persisted && (document.body.classList.remove('unloading'), document.querySelectorAll('.cart__checkout').forEach((el) => {
      el.classList.remove('btn--loading');
    }));
  }, theme.pageTransitions = function () {
    document.body.dataset.transitions === 'true' && (navigator.userAgent.match(/Version\/[\d.].*Safari/) && document.querySelectorAll('a').forEach((a) => {
      window.setTimeout(() => {
        document.body.classList.remove('unloading');
      }, 1200);
    }), document.querySelectorAll('a[href^="mailto:"], a[href^="#"], a[target="_blank"], a[href*="youtube.com/watch"], a[href*="youtu.be/"], a[download]').forEach((el) => {
      el.classList.add('js-no-transition');
    }), document.querySelectorAll('a:not(.js-no-transition)').forEach((el) => {
      el.addEventListener('click', (evt) => {
        if (evt.metaKey) {
          return !0;
        } evt.preventDefault(), document.body.classList.add('unloading'); const src = el.getAttribute('href'); window.setTimeout(() => {
          location.href = src;
        }, 50);
      });
    }), document.querySelectorAll('a.mobile-nav__link').forEach((el) => {
      el.addEventListener('click', () => {
        theme.NavDrawer.close();
      });
    }));
  }, theme.parallaxSections = {}, theme.Parallax = (function () {
    const speed = 0.85; let reset = !1; function parallax(container, args) {
      this.isInit = !1, this.isVisible = !1, this.container = container, this.image = container.querySelector('.parallax-image'), this.namespace = args.namespace, this.desktopOnly = args.desktopOnly, !(!this.container || !this.image) && (this.desktopOnly && (document.addEventListener('matchSmall', () => {
        this.destroy();
      }), document.addEventListener('unmatchSmall', () => {
        this.init(!0);
      })), this.init(this.desktopOnly));
    } return parallax.prototype = Object.assign({}, parallax.prototype, { init(desktopOnly) {
      if (this.isInit && this.destroy(), this.isInit = !0, !(desktopOnly && theme.config.bpSmall)) {
        this.setSizes(), this.scrollHandler(); const observer = new IntersectionObserver((entries, observer2) => {
          entries.forEach((entry) => {
            this.isVisible = entry.isIntersecting, this.isVisible ? window.on(`scroll${this.namespace}`, this.onScroll.bind(this)) : window.off(`scroll${this.namespace}`);
          });
        }, { rootMargin: '200px 0px 200px 0px' }); observer.observe(this.container), window.on(`resize${this.namespace}`, theme.utils.debounce(250, this.setSizes.bind(this))), document.addEventListener('shopify:section:reorder', theme.utils.debounce(250, this.onReorder.bind(this)));
      }
    }, onScroll() {
      this.isVisible && (window.SPR && !reset && (this.setSizes(), reset = !0), requestAnimationFrame(this.scrollHandler.bind(this)));
    }, scrollHandler() {
      const shiftDistance = (window.scrollY - this.elTop) * speed; this.image.style.transform = `translate3d(0, ${shiftDistance}px, 0)`;
    }, setSizes() {
      const rect = this.container.getBoundingClientRect(); this.elTop = rect.top + window.scrollY;
    }, onReorder() {
      this.setSizes(), this.onScroll();
    }, destroy() {
      this.image.style.transform = 'none', window.off(`scroll${this.namespace}`), window.off(`resize${this.namespace}`);
    } }), parallax;
  }()), typeof window.noUiSlider > 'u') {
    throw new Error('theme.PriceRange is missing vendor noUiSlider: // =require vendor/nouislider.js');
  } if (theme.PriceRange = (function () {
    const defaultStep = 10; const selectors = { priceRange: '.price-range', priceRangeSlider: '.price-range__slider', priceRangeInputMin: '.price-range__input-min', priceRangeInputMax: '.price-range__input-max', priceRangeDisplayMin: '.price-range__display-min', priceRangeDisplayMax: '.price-range__display-max' }; function PriceRange(container, { onChange, onUpdate, ...sliderOptions } = {}) {
      return this.container = container, this.onChange = onChange, this.onUpdate = onUpdate, this.sliderOptions = sliderOptions || {}, this.init();
    } return PriceRange.prototype = Object.assign({}, PriceRange.prototype, { init() {
      if (!this.container.classList.contains('price-range')) {
        throw new Error('You must instantiate PriceRange with a valid container');
      } return this.formEl = this.container.closest('form'), this.sliderEl = this.container.querySelector(selectors.priceRangeSlider), this.inputMinEl = this.container.querySelector(selectors.priceRangeInputMin), this.inputMaxEl = this.container.querySelector(selectors.priceRangeInputMax), this.displayMinEl = this.container.querySelector(selectors.priceRangeDisplayMin), this.displayMaxEl = this.container.querySelector(selectors.priceRangeDisplayMax), this.minRange = Number.parseFloat(this.container.dataset.min) || 0, this.minValue = Number.parseFloat(this.container.dataset.minValue) || 0, this.maxRange = Number.parseFloat(this.container.dataset.max) || 100, this.maxValue = Number.parseFloat(this.container.dataset.maxValue) || this.maxRange, this.createPriceRange();
    }, createPriceRange() {
      this.sliderEl && this.sliderEl.noUiSlider && typeof this.sliderEl.noUiSlider.destroy == 'function' && this.sliderEl.noUiSlider.destroy(); const slider = noUiSlider.create(this.sliderEl, { connect: !0, step: defaultStep, ...this.sliderOptions, start: [this.minValue, this.maxValue], range: { min: this.minRange, max: this.maxRange } }); return slider.on('update', (values) => {
        this.displayMinEl.innerHTML = theme.Currency.formatMoney(values[0], theme.settings.moneyFormat), this.displayMaxEl.innerHTML = theme.Currency.formatMoney(values[1], theme.settings.moneyFormat), this.onUpdate && this.onUpdate(values);
      }), slider.on('change', (values) => {
        if (this.inputMinEl.value = values[0], this.inputMaxEl.value = values[1], this.onChange) {
          const formData = new FormData(this.formEl); this.onChange(formData);
        }
      }), slider;
    } }), PriceRange;
  }()), theme.AjaxProduct = (function () {
    const status = { loading: !1 }; function ProductForm(form, submit, args) {
      this.form = form, this.args = args; const submitSelector = submit || '.add-to-cart'; this.form && (this.addToCart = form.querySelector(submitSelector), this.form.addEventListener('submit', this.addItemFromForm.bind(this)));
    } return ProductForm.prototype = Object.assign({}, ProductForm.prototype, { addItemFromForm(evt, callback) {
      if (evt.preventDefault(), !status.loading) {
        this.addToCart.classList.add('btn--loading'), status.loading = !0; const data = theme.utils.serialize(this.form); fetch(theme.routes.cartAdd, { method: 'POST', body: data, credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' } }).then(response => response.json()).then((data2) => {
          if (data2.status === 422) {
            this.error(data2);
          } else {
            const product = data2; this.success(product);
          }status.loading = !1, this.addToCart.classList.remove('btn--loading'), document.body.classList.contains('template-cart') && (window.scrollTo(0, 0), location.reload());
        });
      }
    }, success(product) {
      const errors = this.form.querySelector('.errors'); errors && errors.remove(), document.dispatchEvent(new CustomEvent('ajaxProduct:added', { detail: { product, addToCartBtn: this.addToCart } })), this.args && this.args.scopedEventId && document.dispatchEvent(new CustomEvent(`ajaxProduct:added:${this.args.scopedEventId}`, { detail: { product, addToCartBtn: this.addToCart } }));
    }, error(error) {
      if (!error.description) {
        console.warn(error); return;
      } const errors = this.form.querySelector('.errors'); errors && errors.remove(); const errorDiv = document.createElement('div'); errorDiv.classList.add('errors', 'text-center'), errorDiv.textContent = error.description, this.form.append(errorDiv), document.dispatchEvent(new CustomEvent('ajaxProduct:error', { detail: { errorMessage: error.description } })), this.args && this.args.scopedEventId && document.dispatchEvent(new CustomEvent(`ajaxProduct:error:${this.args.scopedEventId}`, { detail: { errorMessage: error.description } }));
    } }), ProductForm;
  }()), theme.ProductMedia = (function () {
    const modelJsonSections = {}; const models = {}; const xrButtons = {}; const selectors = { mediaGroup: '[data-product-single-media-group]', xrButton: '[data-shopify-xr]' }; function init(modelViewerContainers, sectionId) {
      modelJsonSections[sectionId] = { loaded: !1 }, modelViewerContainers.forEach((container, index) => {
        const mediaId = container.dataset.mediaId; const modelViewerElement = container.querySelector('model-viewer'); const modelId = modelViewerElement.dataset.modelId; if (index === 0) {
          const mediaGroup = container.closest(selectors.mediaGroup); const xrButton = mediaGroup.querySelector(selectors.xrButton); xrButtons[sectionId] = { element: xrButton, defaultId: modelId };
        }models[mediaId] = { modelId, sectionId, container, element: modelViewerElement };
      }), window.Shopify.loadFeatures([{ name: 'shopify-xr', version: '1.0', onLoad: setupShopifyXr }, { name: 'model-viewer-ui', version: '1.0', onLoad: setupModelViewerUi }]), theme.LibraryLoader.load('modelViewerUiStyles');
    } function setupShopifyXr(errors) {
      if (!errors) {
        if (!window.ShopifyXR) {
          document.addEventListener('shopify_xr_initialized', () => {
            setupShopifyXr();
          }); return;
        } for (const sectionId in modelJsonSections) {
          if (modelJsonSections.hasOwnProperty(sectionId)) {
            const modelSection = modelJsonSections[sectionId]; if (modelSection.loaded) {
              continue;
            } const modelJson = document.querySelector(`#ModelJson-${sectionId}`); window.ShopifyXR.addModels(JSON.parse(modelJson.innerHTML)), modelSection.loaded = !0;
          }
        }window.ShopifyXR.setupXRElements();
      }
    } function setupModelViewerUi(errors) {
      if (!errors) {
        for (const key in models) {
          if (models.hasOwnProperty(key)) {
            const model = models[key]; !model.modelViewerUi && Shopify && (model.modelViewerUi = new Shopify.ModelViewerUI(model.element)), setupModelViewerListeners(model);
          }
        }
      }
    } function setupModelViewerListeners(model) {
      const xrButton = xrButtons[model.sectionId]; model.container.addEventListener('mediaVisible', () => {
        xrButton.element.setAttribute('data-shopify-model3d-id', model.modelId), !theme.config.isTouch && model.modelViewerUi.play();
      }), model.container.addEventListener('mediaHidden', () => {
        xrButton.element.setAttribute('data-shopify-model3d-id', xrButton.defaultId), model.modelViewerUi.pause();
      }), model.container.addEventListener('xrLaunch', () => {
        model.modelViewerUi.pause();
      });
    } function removeSectionModels(sectionId) {
      for (const key in models) {
        if (models.hasOwnProperty(key)) {
          const model = models[key]; model.sectionId === sectionId && delete models[key];
        }
      } delete modelJsonSections[sectionId];
    } return { init, removeSectionModels };
  }()), theme.QtySelector = (function () {
    const selectors = { input: '.js-qty__num', plus: '.js-qty__adjust--plus', minus: '.js-qty__adjust--minus' }; function QtySelector(el, options) {
      this.wrapper = el, this.plus = el.querySelector(selectors.plus), this.minus = el.querySelector(selectors.minus), this.input = el.querySelector(selectors.input), this.minValue = this.input.getAttribute('min') || 1; const defaults = { namespace: null, isCart: !1, key: this.input.dataset.id }; this.options = Object.assign({}, defaults, options), this.init();
    } return QtySelector.prototype = Object.assign({}, QtySelector.prototype, { init() {
      this.plus.addEventListener('click', () => {
        const qty = this._getQty(); this._change(qty + 1);
      }), this.minus.addEventListener('click', () => {
        const qty = this._getQty(); this._change(qty - 1);
      }), this.input.addEventListener('change', (evt) => {
        this._change(this._getQty());
      });
    }, _getQty() {
      let qty = this.input.value; return Number.parseFloat(qty) == Number.parseInt(qty) && !isNaN(qty) || (qty = 1), Number.parseInt(qty);
    }, _change(qty) {
      qty <= this.minValue && (qty = this.minValue), this.input.value = qty, this.options.isCart && document.dispatchEvent(new CustomEvent(`cart:quantity${this.options.namespace}`, { detail: [this.options.key, qty, this.wrapper] }));
    } }), QtySelector;
  }()), theme.Slideshow = (function () {
    const classes = { animateOut: 'animate-out', isPaused: 'is-paused', isActive: 'is-active' }; const selectors = { allSlides: '.slideshow__slide', currentSlide: '.is-selected', wrapper: '.slideshow-wrapper', pauseButton: '.slideshow__pause' }; const productSelectors = { thumb: '.product__thumb-item:not(.hide)', links: '.product__thumb-item:not(.hide) a', arrow: '.product__thumb-arrow' }; const defaults = { adaptiveHeight: !1, autoPlay: !1, avoidReflow: !1, childNav: null, childNavScroller: null, childVertical: !1, dragThreshold: 7, fade: !1, friction: 0.8, initialIndex: 0, pageDots: !1, pauseAutoPlayOnHover: !1, prevNextButtons: !1, rightToLeft: theme.config.rtl, selectedAttraction: 0.14, setGallerySize: !0, wrapAround: !0 }; function slideshow(el, args) {
      if (this.el = el, this.args = Object.assign({}, defaults, args), this.args.on = { ready: this.init.bind(this), change: this.slideChange.bind(this), settle: this.afterChange.bind(this) }, this.args.childNav && (this.childNavEls = this.args.childNav.querySelectorAll(productSelectors.thumb), this.childNavLinks = this.args.childNav.querySelectorAll(productSelectors.links), this.arrows = this.args.childNav.querySelectorAll(productSelectors.arrow), this.childNavLinks.length && this.initChildNav()), this.args.avoidReflow && avoidReflow(el), this.slideshow = new Flickity(el, this.args), this.args.autoPlay) {
        const wrapper = el.closest(selectors.wrapper); this.pauseBtn = wrapper.querySelector(selectors.pauseButton), this.pauseBtn && this.pauseBtn.addEventListener('click', this._togglePause.bind(this));
      }window.on('resize', theme.utils.debounce(300, () => {
        this.resize();
      })); function avoidReflow(el2) {
        if (el2.id) {
          for (var firstChild = el2.firstChild; firstChild != null && firstChild.nodeType == 3;) {
            firstChild = firstChild.nextSibling;
          } const style = document.createElement('style'); style.innerHTML = `#${el2.id} .flickity-viewport{height:${firstChild.offsetHeight}px}`, document.head.appendChild(style);
        }
      }
    } return slideshow.prototype = Object.assign({}, slideshow.prototype, { init(el) {
      this.currentSlide = this.el.querySelector(selectors.currentSlide), this.args.callbacks && this.args.callbacks.onInit && typeof this.args.callbacks.onInit == 'function' && this.args.callbacks.onInit(this.currentSlide), window.AOS && AOS.refresh();
    }, slideChange(index) {
      this.args.fade && this.currentSlide && (this.currentSlide.classList.add(classes.animateOut), this.currentSlide.addEventListener('transitionend', () => {
        this.currentSlide.classList.remove(classes.animateOut);
      })), this.args.childNav && this.childNavGoTo(index), this.args.callbacks && this.args.callbacks.onChange && typeof this.args.callbacks.onChange == 'function' && this.args.callbacks.onChange(index), this.arrows && this.arrows.length && (this.arrows[0].classList.toggle('hide', index === 0), this.arrows[1].classList.toggle('hide', index === this.childNavLinks.length - 1));
    }, afterChange(index) {
      this.args.fade && this.el.querySelectorAll(selectors.allSlides).forEach((slide) => {
        slide.classList.remove(classes.animateOut);
      }), this.currentSlide = this.el.querySelector(selectors.currentSlide), this.args.childNav && this.childNavGoTo(this.slideshow.selectedIndex);
    }, destroy() {
      this.args.childNav && this.childNavLinks.length && this.childNavLinks.forEach((a) => {
        a.classList.remove(classes.isActive);
      }), this.slideshow.destroy();
    }, reposition() {
      this.slideshow.reposition();
    }, _togglePause() {
      this.pauseBtn.classList.contains(classes.isPaused) ? (this.pauseBtn.classList.remove(classes.isPaused), this.slideshow.playPlayer()) : (this.pauseBtn.classList.add(classes.isPaused), this.slideshow.pausePlayer());
    }, resize() {
      this.slideshow.resize();
    }, play() {
      this.slideshow.playPlayer();
    }, pause() {
      this.slideshow.pausePlayer();
    }, goToSlide(i) {
      this.slideshow.select(i);
    }, setDraggable(enable) {
      this.slideshow.options.draggable = enable, this.slideshow.updateDraggable();
    }, initChildNav() {
      this.childNavLinks[this.args.initialIndex].classList.add('is-active'), this.childNavLinks.forEach((link, i) => {
        link.setAttribute('data-index', i), link.addEventListener('click', (evt) => {
          evt.preventDefault(), this.goToSlide(this.getChildIndex(evt.currentTarget));
        }), link.addEventListener('focus', (evt) => {
          this.goToSlide(this.getChildIndex(evt.currentTarget));
        }), link.addEventListener('keydown', (evt) => {
          evt.keyCode === 13 && this.goToSlide(this.getChildIndex(evt.currentTarget));
        });
      }), this.arrows.length && this.arrows.forEach((arrow) => {
        arrow.addEventListener('click', this.arrowClick.bind(this));
      });
    }, getChildIndex(target) {
      return Number.parseInt(target.dataset.index);
    }, childNavGoTo(index) {
      this.childNavLinks.forEach((a) => {
        a.blur(), a.classList.remove(classes.isActive);
      }); const el = this.childNavLinks[index]; if (el.classList.add(classes.isActive), !!this.args.childNavScroller) {
        if (this.args.childVertical) {
          const elTop = el.offsetTop; this.args.childNavScroller.scrollTop = elTop - 100;
        } else {
          const elLeft = el.offsetLeft; this.args.childNavScroller.scrollLeft = elLeft - 100;
        }
      }
    }, arrowClick(evt) {
      evt.currentTarget.classList.contains('product__thumb-arrow--prev') ? this.slideshow.previous() : this.slideshow.next();
    } }), slideshow;
  }()), theme.VariantAvailability = (function () {
    const classes = { disabled: 'disabled' }; function availability(args) {
      this.type = args.type, this.variantsObject = args.variantsObject, this.currentVariantObject = args.currentVariantObject, this.container = args.container, this.namespace = args.namespace, this.init();
    } return availability.prototype = Object.assign({}, availability.prototype, { init() {
      this.container.on(`variantChange${this.namespace}`, this.setAvailability.bind(this)), this.setAvailability(null, this.currentVariantObject);
    }, setAvailability(evt, variant) {
      if (evt) {
        var variant = evt.detail.variant;
      } const valuesToManage = { option1: [], option2: [], option3: [] }; const ignoreIndex = null; const availableVariants = this.variantsObject.filter((el) => {
        if (!variant || variant.id === el.id) {
          return !1;
        } if (variant.option2 === el.option2 && variant.option3 === el.option3 || variant.option1 === el.option1 && variant.option3 === el.option3 || variant.option1 === el.option1 && variant.option2 === el.option2) {
          return !0;
        }
      }); const variantObject = { variant }; const variants = Object.assign({}, { variant }, availableVariants); this.container.querySelectorAll('.variant-input-wrap').forEach((group) => {
        this.disableVariantGroup(group);
      }); for (const property in variants) {
        if (variants.hasOwnProperty(property)) {
          const item = variants[property]; if (!item) {
            return;
          } const value1 = item.option1; const value2 = item.option2; const value3 = item.option3; const soldOut = item.available === !1; value1 && ignoreIndex !== 'option1' && valuesToManage.option1.push({ value: value1, soldOut }), value2 && ignoreIndex !== 'option2' && valuesToManage.option2.push({ value: value2, soldOut }), value3 && ignoreIndex !== 'option3' && valuesToManage.option3.push({ value: value3, soldOut });
        }
      } for (const [option, values] of Object.entries(valuesToManage)) {
        this.manageOptionState(option, values);
      }
    }, manageOptionState(option, values) {
      const group = this.container.querySelector(`.variant-input-wrap[data-index="${option}"]`); values.forEach((obj) => {
        this.enableVariantOption(group, obj);
      });
    }, enableVariantOptionByValue(array, index) {
      for (let group = this.container.querySelector(`.variant-input-wrap[data-index="${index}"]`), i = 0; i < array.length; i++) {
        this.enableVariantOption(group, array[i]);
      }
    }, enableVariantOption(group, obj) {
      const value = obj.value.replace(/([ #;&,.+*~':"!^$[\]()=>|/@])/g, '\\$1'); if (this.type === 'dropdown') {
        group.querySelector(`option[value="${value}"]`).disabled = !1;
      } else {
        const buttonGroup = group.querySelector(`.variant-input[data-value="${value}"]`); const input = buttonGroup.querySelector('input'); const label = buttonGroup.querySelector('label'); input.classList.remove(classes.disabled), label.classList.remove(classes.disabled), obj.soldOut && (input.classList.add(classes.disabled), label.classList.add(classes.disabled));
      }
    }, disableVariantGroup(group) {
      this.type === 'dropdown'
        ? group.querySelectorAll('option').forEach((option) => {
          option.disabled = !0;
        })
        : (group.querySelectorAll('input').forEach((input) => {
            input.classList.add(classes.disabled);
          }), group.querySelectorAll('label').forEach((label) => {
            label.classList.add(classes.disabled);
          }));
    } }), availability;
  }()), theme.videoModal = function () {
    let youtubePlayer; const videoHolderId = 'VideoHolder'; const selectors = { youtube: 'a[href*="youtube.com/watch"], a[href*="youtu.be/"]', mp4Trigger: '.product-video-trigger--mp4', mp4Player: '.product-video-mp4-sound' }; const youtubeTriggers = document.querySelectorAll(selectors.youtube); const mp4Triggers = document.querySelectorAll(selectors.mp4Trigger); if (!youtubeTriggers.length && !mp4Triggers.length) {
      return;
    } const videoHolderDiv = document.getElementById(videoHolderId); youtubeTriggers.length && theme.LibraryLoader.load('youtubeSdk'); const modal = new theme.Modals('VideoModal', 'video-modal', { closeOffContentClick: !0, bodyOpenClass: ['modal-open', 'video-modal-open'], solid: !0 }); youtubeTriggers.forEach((btn) => {
      btn.addEventListener('click', triggerYouTubeModal);
    }), mp4Triggers.forEach((btn) => {
      btn.addEventListener('click', triggerMp4Modal);
    }), document.addEventListener('modalClose.VideoModal', closeVideoModal); function triggerYouTubeModal(evt) {
      if (theme.config.youTubeReady) {
        evt.preventDefault(), emptyVideoHolder(), modal.open(evt); const videoId = getYoutubeVideoId(evt.currentTarget.getAttribute('href')); youtubePlayer = new theme.YouTube(videoHolderId, { videoId, style: 'sound', events: { onReady: onYoutubeReady } });
      }
    } function triggerMp4Modal(evt) {
      emptyVideoHolder(); const el = evt.currentTarget; const player = el.parentNode.querySelector(selectors.mp4Player); const playerClone = player.cloneNode(!0); playerClone.classList.remove('hide'), videoHolderDiv.append(playerClone), modal.open(evt), videoHolderDiv.querySelector('video').play();
    } function onYoutubeReady(evt) {
      evt.target.unMute(), evt.target.playVideo();
    } function getYoutubeVideoId(url) {
      const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/; const match = url.match(regExp); return match && match[7].length == 11 ? match[7] : !1;
    } function emptyVideoHolder() {
      videoHolderDiv.innerHTML = '';
    } function closeVideoModal() {
      youtubePlayer && typeof youtubePlayer.destroy == 'function' ? youtubePlayer.destroy() : emptyVideoHolder();
    }
  }, theme.announcementBar = (function () {
    const args = { autoPlay: 5e3, avoidReflow: !0, cellAlign: theme.config.rtl ? 'right' : 'left', fade: !0 }; let bar; let flickity; function init() {
      bar = document.getElementById('AnnouncementSlider'), bar && (unload(), bar.dataset.blockCount !== 1 && (flickity = new theme.Slideshow(bar, args)));
    } function onBlockSelect(id) {
      const slide = bar.querySelector(`#AnnouncementSlide-${id}`); const index = Number.parseInt(slide.dataset.index); flickity && typeof flickity.pause == 'function' && (flickity.goToSlide(index), flickity.pause());
    } function onBlockDeselect() {
      flickity && typeof flickity.play == 'function' && flickity.play();
    } function unload() {
      flickity && typeof flickity.destroy == 'function' && flickity.destroy();
    } return { init, onBlockSelect, onBlockDeselect, unload };
  }()), theme.customerTemplates = function () {
    checkUrlHash(), initEventListeners(), resetPasswordSuccess(), customerAddressForm(); function checkUrlHash() {
      const hash = window.location.hash; hash === '#recover' && toggleRecoverPasswordForm();
    } function toggleRecoverPasswordForm() {
      const passwordForm = document.getElementById('RecoverPasswordForm').classList.toggle('hide'); const loginForm = document.getElementById('CustomerLoginForm').classList.toggle('hide');
    } function initEventListeners() {
      const recoverForm = document.getElementById('RecoverPassword'); recoverForm && recoverForm.addEventListener('click', (evt) => {
        evt.preventDefault(), toggleRecoverPasswordForm();
      }); const hideRecoverPassword = document.getElementById('HideRecoverPasswordLink'); hideRecoverPassword && hideRecoverPassword.addEventListener('click', (evt) => {
        evt.preventDefault(), toggleRecoverPasswordForm();
      });
    } function resetPasswordSuccess() {
      const formState = document.querySelector('.reset-password-success'); formState && document.getElementById('ResetSuccess').classList.remove('hide');
    } function customerAddressForm() {
      const newAddressForm = document.getElementById('AddressNewForm'); const addressForms = document.querySelectorAll('.js-address-form'); !newAddressForm || !addressForms.length || (setTimeout(() => {
        document.querySelectorAll('.js-address-country').forEach((el) => {
          const countryId = el.dataset.countryId; const provinceId = el.dataset.provinceId; const provinceContainerId = el.dataset.provinceContainerId; new Shopify.CountryProvinceSelector(countryId, provinceId, { hideElement: provinceContainerId });
        });
      }, 1e3), document.querySelectorAll('.address-new-toggle').forEach((el) => {
        el.addEventListener('click', () => {
          newAddressForm.classList.toggle('hide');
        });
      }), document.querySelectorAll('.address-edit-toggle').forEach((el) => {
        el.addEventListener('click', (evt) => {
          const formId = evt.currentTarget.dataset.formId; document.getElementById(`EditAddress_${formId}`).classList.toggle('hide');
        });
      }), document.querySelectorAll('.address-delete').forEach((el) => {
        el.addEventListener('click', (evt) => {
          const formId = evt.currentTarget.dataset.formId; const confirmMessage = evt.currentTarget.dataset.confirmMessage; confirm(confirmMessage || 'Are you sure you wish to delete this address?') && Shopify && Shopify.postLink(`/account/addresses/${formId}`, { parameters: { _method: 'delete' } });
        });
      }));
    }
  }, theme.headerNav = (function () {
    const selectors = { wrapper: '#HeaderWrapper', siteHeader: '#SiteHeader', logo: '#LogoContainer img', megamenu: '.megamenu', navigation: '.site-navigation', navItems: '.site-nav__item', navLinks: '.site-nav__link', navLinksWithDropdown: '.site-nav__link--has-dropdown', navDropdownLinks: '.site-nav__dropdown-link--second-level', triggerCollapsedMenu: '.site-nav__compress-menu', collapsedMenu: '[data-type="nav"]', bottomSearch: '[data-type="search"]' }; const classes = { hasDropdownClass: 'site-nav--has-dropdown', hasSubDropdownClass: 'site-nav__deep-dropdown-trigger', dropdownActive: 'is-focused', headerCompressed: 'header-wrapper--compressed', overlay: 'header-wrapper--overlay', overlayStyle: 'is-light' }; const config = { namespace: '.siteNav', wrapperOverlayed: !1, stickyEnabled: !1, stickyActive: !1, subarPositionInit: !1, threshold: 0 }; let wrapper; let siteHeader; let bottomNav; let bottomSearch; function init() {
      wrapper = document.querySelector(selectors.wrapper), siteHeader = document.querySelector(selectors.siteHeader), bottomNav = wrapper.querySelector(selectors.collapsedMenu), bottomSearch = wrapper.querySelector(selectors.bottomSearch), config.threshold = wrapper.getBoundingClientRect().top, config.subarPositionInit = !1, config.stickyEnabled = siteHeader.dataset.sticky === 'true', config.stickyEnabled ? (config.wrapperOverlayed = wrapper.classList.contains(classes.overlayStyle), stickyHeaderCheck()) : disableSticky(), theme.settings.overlayHeader = siteHeader.dataset.overlay === 'true', theme.settings.overlayHeader && Shopify && Shopify.designMode && document.body.classList.contains('template-collection') && !document.querySelector('.collection-hero') && this.disableOverlayHeader(), setAbsoluteBottom(), window.on(`resize${config.namespace}`, theme.utils.debounce(250, setAbsoluteBottom)); const collapsedNavTrigger = wrapper.querySelector(selectors.triggerCollapsedMenu); collapsedNavTrigger && collapsedNavTrigger.on('click', () => {
        collapsedNavTrigger.classList.toggle('is-active'), theme.utils.prepareTransition(bottomNav, () => {
          bottomNav.classList.toggle('is-active');
        });
      }), accessibleDropdowns(); const navigation = siteHeader.querySelector(selectors.navigation); navigation.querySelectorAll('.grid-product') && (new theme.QuickAdd(navigation), new theme.QuickShop(navigation)), window.on(`load${config.namespace}`, resizeLogo), window.on(`resize${config.namespace}`, theme.utils.debounce(150, resizeLogo));
    } function setAbsoluteBottom() {
      theme.settings.overlayHeader && document.querySelector('.header-section').classList.add('header-section--overlay'); const activeSubBar = theme.config.bpSmall ? document.querySelector('.site-header__element--sub[data-type="search"]') : document.querySelector('.site-header__element--sub[data-type="nav"]'); if (activeSubBar) {
        const h = activeSubBar.offsetHeight; h !== 0 && document.documentElement.style.setProperty('--header-padding-bottom', `${h}px`), config.subarPositionInit || (wrapper.classList.add('header-wrapper--init'), config.subarPositionInit = !0);
      }
    } function disableOverlayHeader() {
      wrapper.classList.remove(config.overlayEnabledClass, classes.overlayStyle), config.wrapperOverlayed = !1, theme.settings.overlayHeader = !1;
    } function stickyHeaderCheck() {
      theme.config.stickyHeader = doesMegaMenuFit(), theme.config.stickyHeader ? (config.forceStopSticky = !1, stickyHeader()) : (config.forceStopSticky = !0, disableSticky());
    } function disableSticky() {
      document.querySelector('.header-section').style.position = 'relative';
    } function removeOverlayClass() {
      config.wrapperOverlayed && wrapper.classList.remove(classes.overlayStyle);
    } function doesMegaMenuFit() {
      let largestMegaNav = 0; return siteHeader.querySelectorAll(selectors.megamenu).forEach((nav) => {
        const h = nav.offsetHeight; h > largestMegaNav && (largestMegaNav = h);
      }), !(window.innerHeight < largestMegaNav + 120);
    } function stickyHeader() {
      window.scrollY > config.threshold && stickyHeaderScroll(), window.on(`scroll${config.namespace}`, stickyHeaderScroll);
    } function stickyHeaderScroll() {
      config.stickyEnabled && (config.forceStopSticky || requestAnimationFrame(scrollHandler));
    } function scrollHandler() {
      if (window.scrollY > config.threshold) {
        if (config.stickyActive) {
          return;
        } bottomNav && theme.utils.prepareTransition(bottomNav), bottomSearch && theme.utils.prepareTransition(bottomSearch), config.stickyActive = !0, wrapper.classList.add(classes.headerCompressed), config.wrapperOverlayed && wrapper.classList.remove(classes.overlayStyle), document.dispatchEvent(new CustomEvent('headerStickyChange'));
      } else {
        if (!config.stickyActive) {
          return;
        } bottomNav && theme.utils.prepareTransition(bottomNav), bottomSearch && theme.utils.prepareTransition(bottomSearch), config.stickyActive = !1, config.threshold = wrapper.getBoundingClientRect().top, wrapper.classList.remove(classes.headerCompressed), config.wrapperOverlayed && wrapper.classList.add(classes.overlayStyle), document.dispatchEvent(new CustomEvent('headerStickyChange'));
      }
    } function accessibleDropdowns() {
      let hasActiveDropdown = !1; let hasActiveSubDropdown = !1; let closeOnClickActive = !1; theme.config.isTouch && document.querySelectorAll(selectors.navLinksWithDropdown).forEach((el) => {
        el.on(`touchend${config.namespace}`, (evt) => {
          const parent = evt.currentTarget.parentNode; parent.classList.contains(classes.dropdownActive) ? window.location.replace(evt.currentTarget.getAttribute('href')) : (evt.preventDefault(), closeDropdowns(), openFirstLevelDropdown(evt.currentTarget));
        });
      }), document.querySelectorAll(selectors.navLinks).forEach((el) => {
        el.on(`focusin${config.namespace}`, accessibleMouseEvent), el.on(`mouseover${config.namespace}`, accessibleMouseEvent), el.on(`mouseleave${config.namespace}`, closeDropdowns);
      }), document.querySelectorAll(selectors.navDropdownLinks).forEach((el) => {
        theme.config.isTouch && el.on(`touchend${config.namespace}`, (evt) => {
          const parent = evt.currentTarget.parentNode; parent.classList.contains(classes.hasSubDropdownClass) ? parent.classList.contains(classes.dropdownActive) ? window.location.replace(evt.currentTarget.getAttribute('href')) : (evt.preventDefault(), closeThirdLevelDropdown(), openSecondLevelDropdown(evt.currentTarget)) : window.location.replace(evt.currentTarget.getAttribute('href'));
        }), el.on(`focusin${config.namespace}`, (evt) => {
          closeThirdLevelDropdown(), openSecondLevelDropdown(evt.currentTarget, !0);
        });
      }), theme.config.isTouch && (document.body.on(`touchend${config.namespace}`, () => {
        closeDropdowns();
      }), siteHeader.querySelectorAll(selectors.megamenu).forEach((el) => {
        el.on(`touchend${config.namespace}`, (evt) => {
          evt.stopImmediatePropagation();
        });
      })); function accessibleMouseEvent(evt) {
        hasActiveDropdown && closeSecondLevelDropdown(), hasActiveSubDropdown && closeThirdLevelDropdown(), openFirstLevelDropdown(evt.currentTarget);
      } function openFirstLevelDropdown(el) {
        const parent = el.parentNode; if (parent.classList.contains(classes.hasDropdownClass) && (parent.classList.add(classes.dropdownActive), hasActiveDropdown = !0), !theme.config.isTouch && !closeOnClickActive) {
          const eventType = theme.config.isTouch ? 'touchend' : 'click'; closeOnClickActive = !0, document.documentElement.on(eventType + config.namespace, () => {
            closeDropdowns(), document.documentElement.off(eventType + config.namespace), closeOnClickActive = !1;
          });
        }
      } function openSecondLevelDropdown(el, skipCheck) {
        const parent = el.parentNode; (parent.classList.contains(classes.hasSubDropdownClass) || skipCheck) && (parent.classList.add(classes.dropdownActive), hasActiveSubDropdown = !0);
      } function closeDropdowns() {
        closeSecondLevelDropdown(), closeThirdLevelDropdown();
      } function closeSecondLevelDropdown() {
        document.querySelectorAll(selectors.navItems).forEach((el) => {
          el.classList.remove(classes.dropdownActive);
        });
      } function closeThirdLevelDropdown() {
        document.querySelectorAll(selectors.navDropdownLinks).forEach((el) => {
          el.parentNode.classList.remove(classes.dropdownActive);
        });
      }
    } function resizeLogo(evt) {
      document.querySelectorAll(selectors.logo).forEach((logo) => {
        const logoWidthOnScreen = logo.clientWidth; const containerWidth = logo.closest('.header-item').clientWidth; logoWidthOnScreen > containerWidth ? logo.style.maxWidth = containerWidth : logo.removeAttribute('style');
      });
    } return { init, removeOverlayClass, disableOverlayHeader };
  }()), theme.MobileNav = (function () {
    const selectors = { wrapper: '.slide-nav__wrapper', nav: '.slide-nav', childList: '.slide-nav__dropdown', allLinks: 'a.slide-nav__link', subNavToggleBtn: '.js-toggle-submenu', openBtn: '.mobile-nav-trigger' }; const classes = { isActive: 'is-active' }; const defaults = { isOpen: !1, menuLevel: 1, inHeader: !1 }; function MobileNav(args) {
      this.config = Object.assign({}, defaults, args), this.namespace = `.nav-header-${args.id}`, this.container = document.getElementById(this.config.id), this.container && (this.wrapper = this.container.querySelector(selectors.wrapper), this.wrapper && (this.nav = this.wrapper.querySelector(selectors.nav), this.openTriggers = document.querySelectorAll(selectors.openBtn), this.init()));
    } return MobileNav.prototype = Object.assign({}, MobileNav.prototype, { init() {
      this.openTriggers.length && this.openTriggers.forEach((btn) => {
        btn.addEventListener('click', () => {
          this.config.isOpen ? this.close() : this.open();
        });
      }), this.nav.querySelectorAll(selectors.subNavToggleBtn).forEach((btn) => {
        btn.addEventListener('click', this.toggleSubNav.bind(this));
      }), this.nav.querySelectorAll(selectors.allLinks).forEach((link) => {
        link.addEventListener('click', this.close.bind(this));
      }), this.inHeader && (document.addEventListener('unmatchSmall', () => {
        this.close(null, !0);
      }), document.addEventListener('CartDrawer:open', this.close.bind(this)), document.addEventListener('mobileNav:open', this.open.bind(this)), document.addEventListener('mobileNav:close', this.close.bind(this)));
    }, open(evt) {
      evt && evt.preventDefault(), theme.sizeDrawer(), this.openTriggers.forEach((btn) => {
        btn.classList.add('is-active');
      }), theme.utils.prepareTransition(this.container, () => {
        this.container.classList.add('is-active');
      }), window.on(`keyup${this.namespace}`, (evt2) => {
        evt2.keyCode === 27 && this.close();
      }), theme.headerNav.removeOverlayClass(), document.documentElement.classList.add('mobile-nav-open'), document.dispatchEvent(new CustomEvent('MobileNav:open')), this.config.isOpen = !0, setTimeout(() => {
        window.on(`click${this.namespace}`, (evt2) => {
          this.close(evt2);
        });
      }, 0);
    }, close(evt, noAnimate) {
      let forceClose = !1; evt && evt.target.closest && evt.target.closest('.site-header__drawer') && (evt.currentTarget && evt.currentTarget.classList && evt.currentTarget.classList.contains('slide-nav__link') && (forceClose = !0), !forceClose) || (this.openTriggers.forEach((btn) => {
        btn.classList.remove('is-active');
      }), noAnimate
        ? this.container.classList.remove('is-active')
        : theme.utils.prepareTransition(this.container, () => {
          this.container.classList.remove('is-active');
        }), document.documentElement.classList.remove('mobile-nav-open'), document.dispatchEvent(new CustomEvent('MobileNav:close')), window.off(`keyup${this.namespace}`), window.off(`click${this.namespace}`), this.config.isOpen = !1);
    }, toggleSubNav(evt) {
      const btn = evt.currentTarget; this.goToSubnav(btn.dataset.target);
    }, goToSubnav(target) {
      const targetMenu = this.nav.querySelector(`${selectors.childList}[data-parent="${target}"]`); targetMenu
        ? (this.config.menuLevel = targetMenu.dataset.level, this.config.menuLevel == 2 && this.nav.querySelectorAll(`${selectors.childList}[data-level="3"]`).forEach((list) => {
            list.classList.remove(classes.isActive);
          }), targetMenu.classList.add(classes.isActive), this.setWrapperHeight(targetMenu.offsetHeight))
        : (this.config.menuLevel = 1, this.wrapper.removeAttribute('style'), this.nav.querySelectorAll(selectors.childList).forEach((list) => {
            list.classList.remove(classes.isActive);
          })), this.wrapper.dataset.level = this.config.menuLevel;
    }, setWrapperHeight(h) {
      this.wrapper.style.height = `${h}px`;
    } }), MobileNav;
  }()), theme.headerSearch = (function () {
    let currentString = ''; let isLoading = !1; let searchTimeout; const selectors = { form: '.site-header__search-form', input: 'input[type="search"]', searchInlineContainer: '.site-header__search-container', searchInlineBtn: '.js-search-header', searchButton: '[data-predictive-search-button]', closeSearch: '.site-header__search-btn--cancel', wrapper: '#SearchResultsWrapper', topSearched: '#TopSearched', predictiveWrapper: '#PredictiveWrapper', resultDiv: '#PredictiveResults' }; const cache = {}; let activeForm; const classes = { isActive: 'predicitive-active' }; const config = { namespace: '.search', topSearched: !1, predictiveSearch: !1, imageSize: 'square' }; const keys = { esc: 27, up_arrow: 38, down_arrow: 40, tab: 9 }; function init() {
      if (initInlineSearch(), cache.wrapper = document.querySelector(selectors.wrapper), !!cache.wrapper) {
        if (cache.topSearched = document.querySelector(selectors.topSearched), cache.topSearched && (config.topSearched = !0), theme.settings.predictiveSearch && document.getElementById('shopify-features')) {
          const supportedShopifyFeatures = JSON.parse(document.getElementById('shopify-features').innerHTML); supportedShopifyFeatures.predictiveSearch && (config.predictiveSearch = !0);
        }config.predictiveSearch && (cache.predictiveWrapper = document.querySelector(selectors.predictiveWrapper), config.imageSize = cache.predictiveWrapper.dataset.imageSize, cache.results = document.querySelector(selectors.resultDiv), cache.submit = cache.predictiveWrapper.querySelector(selectors.searchButton), cache.submit.on(`click${config.namespace}`, triggerSearch)), document.querySelectorAll(selectors.form).forEach((form) => {
          initForm(form);
        });
      }
    } function initForm(form) {
      form.setAttribute('autocomplete', 'off'), form.on(`submit${config.namespace}`, submitSearch); const input = form.querySelector(selectors.input); input.on(`focus${config.namespace}`, handleFocus), config.predictiveSearch && input.on(`keyup${config.namespace}`, handleKeyup);
    } function reset() {
      config.predictiveSearch && (cache.predictiveWrapper.classList.add('hide'), cache.results.innerHTML = '', clearTimeout(searchTimeout)), config.topSearched ? cache.topSearched.classList.remove('hide') : cache.wrapper.classList.add('hide');
    } function close(evt) {
      if (evt && evt.target.closest && !evt.target.closest(selectors.closeSearch)) {
        if (evt.target.closest('.site-header__search-form')) {
          return;
        } if (evt.target.closest('.site-header__element--sub')) {
          return;
        } if (evt.target.closest('#SearchResultsWrapper')) {
          return;
        } if (evt.target.closest('.site-header__search-container')) {
          return;
        }
      }document.activeElement.blur(), cache.wrapper.classList.add('hide'), config.topSearched && cache.topSearched.classList.remove('hide'), config.predictiveSearch && (cache.predictiveWrapper.classList.add('hide'), clearTimeout(searchTimeout)), cache.inlineSearchContainer && cache.inlineSearchContainer.classList.remove('is-active'), document.querySelectorAll(selectors.form).forEach((form) => {
        form.classList.remove('is-active');
      }), window.off(`click${config.namespace}`);
    } function initInlineSearch() {
      cache.inlineSearchContainer = document.querySelector(selectors.searchInlineContainer), document.querySelectorAll(selectors.searchInlineBtn).forEach((btn) => {
        btn.addEventListener('click', openInlineSearch);
      });
    } function openInlineSearch(evt) {
      evt.preventDefault(), evt.stopImmediatePropagation(); const container = document.querySelector(selectors.searchInlineContainer); container.classList.add('is-active'), container.querySelector('.site-header__search-input').focus(), enableCloseListeners();
    } function triggerSearch() {
      activeForm && activeForm.submit();
    } function submitSearch(evt) {
      evt.preventDefault ? evt.preventDefault() : evt.returnValue = !1; const obj = {}; const formData = new FormData(evt.target); for (const key of formData.keys()) {
        obj[key] = formData.get(key);
      }obj.q && (obj.q += '*'); const params = paramUrl(obj); return window.location.href = `${theme.routes.search}?${params}`, !1;
    } function handleKeyup(evt) {
      if (activeForm = evt.currentTarget.closest('form'), evt.keyCode !== keys.up_arrow && evt.keyCode !== keys.down_arrow && evt.keyCode !== keys.tab) {
        if (evt.keyCode === keys.esc) {
          close(); return;
        }search(evt.currentTarget);
      }
    } function handleFocus(evt) {
      evt.currentTarget.parentNode.classList.add('is-active'), config.topSearched && cache.wrapper.classList.remove('hide'), enableCloseListeners();
    } function enableCloseListeners() {
      setTimeout(() => {
        window.on(`click${config.namespace}`, (evt) => {
          close(evt);
        });
      }, 0), window.on('keyup', (evt) => {
        evt.keyCode === 27 && close();
      });
    } function search(input) {
      const keyword = input.value; if (keyword === '') {
        reset(); return;
      } const q = _normalizeQuery(keyword); clearTimeout(searchTimeout), searchTimeout = setTimeout(() => {
        predictQuery(q);
      }, 500);
    } function predictQuery(q) {
      if (!isLoading && currentString !== q) {
        currentString = q, isLoading = !0; const searchObj = { q, 'resources[type]': theme.settings.predictiveSearchType, 'resources[limit]': 4, 'resources[options][unavailable_products]': 'last', 'resources[options][fields]': 'title,product_type,variants.title,vendor' }; const params = paramUrl(searchObj); fetch(`/search/suggest.json?${params}`).then(response => response.json()).then((suggestions) => {
          isLoading = !1; const data = {}; let resultCount = 0; cache.topSearched && cache.topSearched.classList.add('hide'), cache.predictiveWrapper.classList.remove('hide'); const resultTypes = Object.entries(suggestions.resources.results); if (Object.keys(resultTypes).forEach((i) => {
            const obj = resultTypes[i]; const type = obj[0]; const results = obj[1]; switch (resultCount += results.length, type) {
              case 'products':data[type] = buildProducts(results); break; case 'collections':data[type] = buildCollections(results); break; case 'pages':data[type] = buildPages(results); break; case 'articles':data[type] = buildArticles(results); break;
            }
          }), resultCount === 0) {
            reset(); return;
          } const output = buildOutput(data); cache.results.innerHTML = '', cache.results.innerHTML = output, cache.wrapper.classList.remove('hide');
        });
      }
    } function buildProducts(results) {
      let output = ''; const products = []; if (results.forEach((product) => {
        const new_product = { title: product.title, url: product.url, image_responsive_url: theme.Images.lazyloadImagePath(product.image), image_aspect_ratio: product.featured_image.aspect_ratio }; products.push(new_product);
      }), products.length) {
        const markup = theme.buildProductGridItem(products, config.imageSize); output = `
          <div data-type-products>
            <div class="new-grid product-grid" data-view="small">
              ${markup}
            </div>
          </div>
        `;
      } return output;
    } function buildCollections(collections) {
      let output = ''; if (collections.length) {
        const markup = theme.buildCollectionItem(collections); output = `
          <div data-type-collections>
            <p class="h6 predictive__label">${theme.strings.searchCollections}</p>
            <ul class="no-bullets">
              ${markup}
            </ul>
          </div>
        `;
      } return output;
    } function buildPages(pages) {
      let output = ''; if (pages.length) {
        const markup = theme.buildPageItem(pages); output = `
          <div data-type-pages>
            <p class="h6 predictive__label">${theme.strings.searchPages}</p>
            <ul class="no-bullets">
              ${markup}
            </ul>
          </div>
        `;
      } return output;
    } function buildArticles(articles) {
      let output = ''; if (articles.forEach((article) => {
        article.image && (article.image = theme.Images.getSizedImageUrl(article.image, '200x200_crop_center'));
      }), articles.length) {
        const markup = theme.buildArticleItem(articles, config.imageSize); output = `
          <div data-type-articles>
            <p class="h6 predictive__label">${theme.strings.searchArticles}</p>
            <div class="grid grid--uniform grid--no-gutters">
              ${markup}
            </div>
          </div>
        `;
      } return output;
    } function buildOutput(data) {
      let output = ''; return data.products && data.products !== '' && (output += data.products), data.collections && data.collections !== '' && (output += data.collections), data.pages && data.pages !== '' && (output += data.pages), data.articles && data.articles !== '' && (output += data.articles), output;
    } function _normalizeQuery(string) {
      return typeof string != 'string' ? null : string.trim().replace(/ /g, '-').toLowerCase();
    } function paramUrl(obj) {
      return Object.keys(obj).map((key) => {
        return `${key}=${encodeURIComponent(obj[key])}`;
      }).join('&');
    } return { init };
  }()), theme.HeaderCart = (function () {
    const selectors = { cartTrigger: '#HeaderCartTrigger', cart: '#HeaderCart', closeBtn: '.js-close-header-cart', noteBtn: '.add-note' }; const classes = { hidden: 'hide' }; const config = { cartOpen: !1, namespace: '.cart-header' }; function HeaderCart() {
      this.wrapper = document.querySelector(selectors.cart), this.wrapper && (this.trigger = document.querySelector(selectors.cartTrigger), this.noteBtn = this.wrapper.querySelector(selectors.noteBtn), this.form = this.wrapper.querySelector('form'), document.addEventListener('MobileNav:open', this.close.bind(this)), document.addEventListener('modalOpen', this.close.bind(this)), this.init());
    } return HeaderCart.prototype = Object.assign({}, HeaderCart.prototype, { init() {
      this.cartForm = new theme.CartForm(this.form), this.quickAdd = new theme.QuickAdd(this.wrapper), this.quickShop = new theme.QuickShop(this.wrapper), this.cartForm.buildCart(), this.trigger.on('click', this.open.bind(this)), document.querySelectorAll(selectors.closeBtn).forEach((btn) => {
        btn.addEventListener('click', () => {
          this.close();
        });
      }), this.noteBtn && this.noteBtn.addEventListener('click', () => {
        this.noteBtn.classList.toggle('is-active'), this.wrapper.querySelector('.cart__note').classList.toggle('hide');
      }), document.addEventListener('ajaxProduct:added', (evt) => {
        this.cartForm.buildCart(), config.cartOpen || this.open();
      }), document.addEventListener('cart:open', this.open.bind(this)), document.addEventListener('cart:close', this.close.bind(this));
    }, open(evt) {
      theme.settings.cartType === 'dropdown' && (evt && evt.preventDefault(), theme.sizeDrawer(), theme.utils.prepareTransition(this.wrapper, () => {
        this.wrapper.classList.add('is-active'), this.wrapper.scrollTop = 0;
      }), document.documentElement.classList.add('cart-open'), theme.a11y.lockMobileScrolling(config.namespace), window.on(`keyup${config.namespace}`, (evt2) => {
        evt2.keyCode === 27 && this.close();
      }), theme.headerNav.removeOverlayClass(), document.dispatchEvent(new CustomEvent('CartDrawer:open')), document.dispatchEvent(new CustomEvent('drawerOpen')), setTimeout(() => {
        window.on(`click${config.namespace}`, (evt2) => {
          this.close(evt2);
        });
      }, 0), config.cartOpen = !0);
    }, close(evt) {
      theme.settings.cartType === 'dropdown' && (evt && evt.target.closest && evt.target.closest('.site-header__cart') || config.cartOpen && (evt && evt.type === 'MobileNav:open'
        ? this.wrapper.classList.remove('is-active')
        : theme.utils.prepareTransition(this.wrapper, () => {
          this.wrapper.classList.remove('is-active');
        }), window.off(`keyup${config.namespace}`), window.off(`click${config.namespace}`), theme.a11y.unlockMobileScrolling(config.namespace), document.documentElement.classList.remove('cart-open'), config.cartOpen = !1));
    } }), HeaderCart;
  }()), theme.QuickAdd = (function () {
    const selectors = { quickAddBtn: '.js-quick-add-btn', quickAddForm: '.js-quick-add-form', quickAddHolder: '#QuickAddHolder' }; let modalInitailized = !1; let modal; function QuickAdd(container) {
      container && theme.settings.quickAdd && (this.container = container, this.init());
    } return QuickAdd.prototype = Object.assign({}, QuickAdd.prototype, { init() {
      const quickAddBtns = this.container.querySelectorAll(selectors.quickAddBtn); quickAddBtns && quickAddBtns.forEach((btn) => {
        btn.addEventListener('click', this.addToCart.bind(this));
      }); const quickAddForms = this.container.querySelectorAll(selectors.quickAddForm); quickAddForms.length && (this.quickAddHolder = document.querySelector(selectors.quickAddHolder), modalInitailized || (modal = new theme.Modals('QuickAddModal', 'quick-add'), modalInitailized = !0, document.addEventListener('modalClose.QuickAddModal', () => {
        setTimeout(() => {
          this.quickAddHolder.innerHTML = '';
        }, 350);
      })), quickAddForms.forEach((btn) => {
        btn.addEventListener('click', this.loadQuickAddForm.bind(this));
      }));
    }, addToCart(evt) {
      const btn = evt.currentTarget; const visibleBtn = btn.querySelector('.btn'); visibleBtn.classList.add('btn--loading'); const id = btn.dataset.id; const data = { items: [{ id, quantity: 1 }] }; fetch(theme.routes.cartAdd, { method: 'POST', body: JSON.stringify(data), credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }).then(response => response.json()).then((data2) => {
        if (!(data2.status === 422 || data2.status === 'bad_request')) {
          const product = data2; document.dispatchEvent(new CustomEvent('ajaxProduct:added', { detail: { product, addToCartBtn: btn } }));
        }visibleBtn.classList.remove('btn--loading');
      });
    }, loadQuickAddForm(evt) {
      this.quickAddHolder.innerHTML = ''; const btn = evt.currentTarget; const gridItem = evt.currentTarget.closest('.grid-product'); const handle = gridItem.getAttribute('data-product-handle'); const prodId = gridItem.getAttribute('data-product-id'); let url = `${theme.routes.home}/products/${handle}?view=form`; url = url.replace('//', '/'), fetch(url).then((response) => {
        return response.text();
      }).then((html) => {
        const parser = new DOMParser(); const doc = parser.parseFromString(html, 'text/html'); const div = doc.querySelector(`.product-section[data-product-handle="${handle}"]`); this.quickAddHolder.append(div), theme.sections.register('product', theme.Product, this.quickAddHolder), Shopify && Shopify.PaymentButton && Shopify.PaymentButton.init(), window.dispatchEvent(new CustomEvent(`quickadd:loaded:${prodId}`)), document.dispatchEvent(new CustomEvent('quickadd:loaded', { detail: { productId: prodId, handle } })), modal.open();
      });
    } }), QuickAdd;
  }()), theme.QuickShop = (function () {
    const loadedIds = []; const selectors = { product: '.grid-product', triggers: '.quick-product__btn', modalContainer: '#ProductModals' }; function QuickShop(container) {
      theme.settings.quickView && (this.container = container, this.init());
    } function getData(el) {
      return { id: el.dataset.productId, handle: el.dataset.productHandle };
    } function productMouseover(evt) {
      const el = evt.currentTarget; if (!theme.config.bpSmall && !(!el || !el.dataset.productId)) {
        const data = getData(el); el.removeEventListener('mouseover', productMouseover), preloadProductModal(data);
      }
    } function preloadProductModal(data) {
      const modals = document.querySelectorAll(`.modal--quick-shop[data-product-id="${data.id}"]`); if (modals.length) {
        if (loadedIds.includes(data.id)) {
          removeDuplicateModals(modals), enableTriggers(data);
        } else {
          moveModal(modals); const holder = document.getElementById(`QuickShopHolder-${data.handle}`); let url = `${theme.routes.home}/products/${data.handle}?view=modal`; url = url.replace('//', '/'), fetch(url).then((response) => {
            return response.text();
          }).then((html) => {
            const parser = new DOMParser(); const doc = parser.parseFromString(html, 'text/html'); const div = doc.querySelector(`.product-section[data-product-handle="${data.handle}"]`); holder && (holder.append(div), theme.sections.register('product', theme.Product, holder), theme.collapsibles.init(), theme.videoModal(), enableTriggers(data));
          });
        }loadedIds.push(data.id);
      }
    } function moveModal(modals) {
      const el = modals[0]; if (el) {
        modals.length > 1 && modals.forEach((m, i) => {
          i > 0 && m.remove();
        }); const container = document.querySelector(selectors.modalContainer); container.appendChild(el);
      }
    } function removeDuplicateModals(modals) {
      modals.length > 1 && modals.forEach((m, i) => {
        m.closest('#ProductModals') || m.remove();
      });
    } function enableTriggers(data) {
      const modalId = `QuickShopModal-${data.id}`; const name = `quick-modal-${data.id}`; new theme.Modals(modalId, name); const triggers = document.querySelectorAll(`${selectors.triggers}[data-handle="${data.handle}"]`); triggers.length && triggers.forEach((trigger) => {
        trigger.classList.remove('quick-product__btn--not-ready');
      });
    } return QuickShop.prototype = Object.assign({}, QuickShop.prototype, { init() {
      const products = this.container.querySelectorAll(selectors.product); products.length && products.forEach((product) => {
        product.addEventListener('mouseover', productMouseover);
      });
    } }), QuickShop;
  }()), theme.buildProductGridItem = function (items, imageSize) {
    let output = ''; return items.forEach((product) => {
      const image = theme.buildProductImage(product, imageSize); const markup = `
        <div class="grid-item grid-product">
          <div class="grid-item__content">
            <a href="${product.url}" class="grid-item__link">
              <div class="grid-product__image-wrap">
                ${image}
              </div>
              <div class="grid-item__meta">
                <div class="grid-product__title">${product.title}</div>
              </div>
            </a>
          </div>
        </div>
      `;output += markup;
    }), output;
  }, theme.buildProductImage = function (product, imageSize) {
    const size = imageSize || theme.settings.productImageSize; let output = ''; if (size === 'natural') {
      output = `
        <div class="image-wrap" style="height: 0; padding-bottom: ${product.image_aspect_ratio}%;">
          <img class="grid-product__image lazyload"
            data-src="${product.image_responsive_url}"
            data-widths="[180, 360, 540, 720, 900]"
            data-aspectratio="${product.image_aspect_ratio}"
            data-sizes="auto"
            alt="${product.title}">
        </div>`;
    } else {
      let classes = 'lazyload'; theme.settings.productImageCover || (classes += ' grid__image-contain'), output = `
        <div class="grid__image-ratio grid__image-ratio--${size}">
          <img class="${classes}"
              data-src="${product.image_responsive_url}"
              data-widths="[360, 540, 720, 900, 1080]"
              data-aspectratio="${product.aspect_ratio}"
              data-sizes="auto"
              alt="${product.title}">
        </div>
      `;
    } return output;
  }, theme.buildCollectionItem = function (items) {
    let output = ''; return items.forEach((collection) => {
      const markup = `
        <li>
          <a href="${collection.url}">
            ${collection.title}
          </a>
        </li>
      `;output += markup;
    }), output;
  }, theme.buildPageItem = function (items) {
    let output = ''; return items.forEach((page) => {
      const markup = `
        <li>
          <a href="${page.url}">
            ${page.title}
          </a>
        </li>
      `;output += markup;
    }), output;
  }, theme.buildArticleItem = function (items, imageSize) {
    let output = ''; return items.forEach((article) => {
      const image = theme.buildPredictiveImage(article); const markup = `
        <div class="grid__item small--one-half medium-up--one-quarter">
          <a href="${article.url}" class="grid-item__link grid-item__link--inline">
            <div class="grid-product__image-wrap">
              <div
                class="grid__image-ratio grid__image-ratio--object grid__image-ratio--${imageSize}">
                <div class="predictive__image-wrap">
                  ${image}
                </div>
              </div>
            </div>
            <div class="grid-item__meta">
              ${article.title}
            </div>
          </a>
        </div>
      `;output += markup;
    }), output;
  }, theme.buildPredictiveImage = function (obj) {
    let imageMarkup = ''; return obj.image && (imageMarkup = `<img class="lazyload"
            data-src="${obj.image}"
            data-widths="[360, 540, 720]"
            data-sizes="auto">`), imageMarkup;
  }, theme.animationObserver = function () {
    const els = document.querySelectorAll('.animation-contents'); els.forEach((el) => {
      const observer = new IntersectionObserver((entries, observer2) => {
        entries.forEach((entry) => {
          entry.isIntersecting && (entry.target.classList.add('is-visible'), observer2.unobserve(entry.target));
        });
      }, { threshold: 1 }); observer.observe(el);
    });
  }, theme.Maps = (function () {
    const config = { zoom: 14 }; let apiStatus = null; const mapsToLoad = []; let errors = {}; const selectors = { section: '[data-section-type="map"]', map: '[data-map]', mapOverlay: '.map-section__overlay' }; window.gm_authFailure = function () {
      Shopify.designMode && (document.querySelectorAll(selectors.section).forEach((section) => {
        section.classList.add('map-section--load-error');
      }), document.querySelectorAll(selectors.map).forEach((map) => {
        map.parentNode.removeChild(map);
      }), window.mapError(theme.strings.authError));
    }, window.mapError = function (error) {
      const message = document.createElement('div'); message.classList.add('map-section__error', 'errors', 'text-center'), message.innerHTML = error, document.querySelectorAll(selectors.mapOverlay).forEach((overlay) => {
        overlay.parentNode.prepend(message);
      }), document.querySelectorAll('.map-section__link').forEach((link) => {
        link.classList.add('hide');
      });
    }; function Map(container) {
      this.container = container, this.sectionId = this.container.getAttribute('data-section-id'), this.namespace = `.map-${this.sectionId}`, this.map = container.querySelector(selectors.map), this.key = this.map.dataset.apiKey, errors = { addressNoResults: theme.strings.addressNoResults, addressQueryLimit: theme.strings.addressQueryLimit, addressError: theme.strings.addressError, authError: theme.strings.authError }, this.key && theme.initWhenVisible({ element: this.container, callback: this.prepMapApi.bind(this), threshold: 20 });
    } function initAllMaps() {
      mapsToLoad.forEach((instance) => {
        instance.createMap();
      });
    } function geolocate(map) {
      const geocoder = new google.maps.Geocoder(); if (map) {
        const address = map.dataset.addressSetting; const deferred = new Promise((resolve, reject) => {
          geocoder.geocode({ address }, (results, status) => {
            status !== google.maps.GeocoderStatus.OK && reject(status), resolve(results);
          });
        }); return deferred;
      }
    } return Map.prototype = Object.assign({}, Map.prototype, { prepMapApi() {
      if (apiStatus === 'loaded') {
        this.createMap();
      } else if (mapsToLoad.push(this), apiStatus !== 'loading' && (apiStatus = 'loading', typeof window.google > 'u' || typeof window.google.maps > 'u')) {
        const script = document.createElement('script'); script.onload = function () {
          apiStatus = 'loaded', initAllMaps();
        }, script.src = `https://maps.googleapis.com/maps/api/js?key=${this.key}`, document.head.appendChild(script);
      }
    }, createMap() {
      const mapDiv = this.map; return geolocate(mapDiv).then((results) => {
        const mapOptions = { zoom: config.zoom, backgroundColor: 'none', center: results[0].geometry.location, draggable: !1, clickableIcons: !1, scrollwheel: !1, disableDoubleClickZoom: !0, disableDefaultUI: !0 }; const map = this.map = new google.maps.Map(mapDiv, mapOptions); const center = this.center = map.getCenter(); const marker = new google.maps.Marker({ map, position: map.getCenter() }); google.maps.event.addDomListener(window, 'resize', theme.utils.debounce(250, () => {
          google.maps.event.trigger(map, 'resize'), map.setCenter(center), mapDiv.removeAttribute('style');
        })), Shopify.designMode && window.AOS && AOS.refreshHard();
      }).catch((status) => {
        let errorMessage; switch (status) {
          case 'ZERO_RESULTS':errorMessage = errors.addressNoResults; break; case 'OVER_QUERY_LIMIT':errorMessage = errors.addressQueryLimit; break; case 'REQUEST_DENIED':errorMessage = errors.authError; break; default:errorMessage = errors.addressError; break;
        }Shopify.designMode && window.mapError(errorMessage);
      });
    }, onUnload() {
      this.map.length !== 0 && google && google.maps && google.maps.event && google.maps.event.clearListeners(this.map, 'resize');
    } }), Map;
  }()), theme.NewsletterPopup = (function () {
    function NewsletterPopup(container) {
      this.container = container; const sectionId = this.container.getAttribute('data-section-id'); if (this.cookieName = `newsletter-${sectionId}`, !!container && window.location.pathname !== '/challenge' && window.location.pathname !== '/password') {
        this.data = { secondsBeforeShow: container.dataset.delaySeconds, daysBeforeReappear: container.dataset.delayDays, cookie: Cookies.get(this.cookieName), testMode: container.dataset.testMode }, this.modal = new theme.Modals(`NewsletterPopup-${sectionId}`, 'newsletter-popup-modal'); const btn = container.querySelector('.popup-cta a'); if (btn && btn.addEventListener('click', () => {
          this.closePopup(!0);
        }), (container.querySelector('.errors') || container.querySelector('.note--success')) && this.modal.open(), container.querySelector('.note--success')) {
          this.closePopup(!0); return;
        }document.addEventListener(`modalClose.${container.id}`, this.closePopup.bind(this)), (!this.data.cookie || this.data.testMode === 'true') && this.initPopupDelay();
      }
    } return NewsletterPopup.prototype = Object.assign({}, NewsletterPopup.prototype, { initPopupDelay() {
      Shopify && Shopify.designMode || setTimeout(() => {
        this.modal.open();
      }, this.data.secondsBeforeShow * 1e3);
    }, closePopup(success) {
      if (this.data.testMode === 'true') {
        Cookies.remove(this.cookieName, { path: '/' }); return;
      } const expiry = success ? 200 : this.data.daysBeforeReappear; Cookies.set(this.cookieName, 'opened', { path: '/', expires: expiry });
    }, onLoad() {
      this.modal.open();
    }, onSelect() {
      this.modal.open();
    }, onDeselect() {
      this.modal.close();
    } }), NewsletterPopup;
  }()), theme.PasswordHeader = (function () {
    function PasswordHeader() {
      this.init();
    } return PasswordHeader.prototype = Object.assign({}, PasswordHeader.prototype, { init() {
      if (document.querySelector('#LoginModal')) {
        const passwordModal = new theme.Modals('LoginModal', 'login-modal', { focusIdOnOpen: 'password', solid: !0 }); document.querySelectorAll('.errors').length && passwordModal.open();
      }
    } }), PasswordHeader;
  }()), theme.Photoswipe = (function () {
    const selectors = { trigger: '.js-photoswipe__zoom', images: '.photoswipe__image', slideshowTrack: '.flickity-viewport ', activeImage: '.is-selected' }; function Photoswipe(container, sectionId) {
      this.container = container, this.sectionId = sectionId, this.namespace = `.photoswipe-${this.sectionId}`, this.gallery, this.images, this.items, this.inSlideshow = !1, !(!container || container.dataset.zoom === 'false') && (container.dataset.hasSlideshow === 'true' && (this.inSlideshow = !0), this.init());
    } return Photoswipe.prototype = Object.assign({}, Photoswipe.prototype, { init() {
      this.container.querySelectorAll(selectors.trigger).forEach((trigger) => {
        trigger.on(`click${this.namespace}`, this.triggerClick.bind(this));
      });
    }, triggerClick(evt) {
      this.items = this.getImageData(); const image = this.inSlideshow ? this.container.querySelector(selectors.activeImage) : evt.currentTarget; const index = this.inSlideshow ? this.getChildIndex(image) : image.dataset.index; this.initGallery(this.items, index);
    }, getChildIndex(el) {
      for (var i = 0; (el = el.previousSibling) != null;) {
        i++;
      } return i + 1;
    }, getImageData() {
      this.images = this.inSlideshow ? this.container.querySelectorAll(selectors.slideshowTrack + selectors.images) : this.container.querySelectorAll(selectors.images); const items = []; const options = {}; return this.images.forEach((el) => {
        const item = { msrc: el.currentSrc || el.src, src: el.getAttribute('data-photoswipe-src'), w: el.getAttribute('data-photoswipe-width'), h: el.getAttribute('data-photoswipe-height'), el, initialZoomLevel: 0.5 }; items.push(item);
      }), items;
    }, initGallery(items, index) {
      const pswpElement = document.querySelectorAll('.pswp')[0]; const options = { allowPanToNext: !1, captionEl: !1, closeOnScroll: !1, counterEl: !1, history: !1, index: index - 1, pinchToClose: !1, preloaderEl: !1, scaleMode: 'zoom', shareEl: !1, tapToToggleControls: !1, getThumbBoundsFn(index2) {
        const pageYScroll = window.pageYOffset || document.documentElement.scrollTop; const thumbnail = items[index2].el; const rect = thumbnail.getBoundingClientRect(); return { x: rect.left, y: rect.top + pageYScroll, w: rect.width };
      } }; this.gallery = new PhotoSwipe(pswpElement, PhotoSwipeUI_Default, items, options), this.gallery.listen('afterChange', this.afterChange.bind(this)), this.gallery.init(), this.preventiOS15Scrolling();
    }, afterChange() {
      const index = this.gallery.getCurrentIndex(); this.container.dispatchEvent(new CustomEvent('photoswipe:afterChange', { detail: { index } }));
    }, syncHeight() {
      document.documentElement.style.setProperty('--window-inner-height', `${window.innerHeight}px`);
    }, preventiOS15Scrolling() {
      let initialScrollPos; /iPhone|iPad|iPod/i.test(window.navigator.userAgent) && (this.syncHeight(), initialScrollPos = window.scrollY, document.documentElement.classList.add('pswp-open-in-ios'), window.addEventListener('resize', this.syncHeight), this.gallery.listen('destroy', () => {
        document.documentElement.classList.remove('pswp-open-in-ios'), window.scrollTo(0, initialScrollPos);
      }));
    } }), Photoswipe;
  }()), theme.Recommendations = (function () {
    const selectors = { placeholder: '.product-recommendations-placeholder', sectionClass: ' .product-recommendations', productResults: '.grid-product' }; function Recommendations(container) {
      this.container = container, this.sectionId = container.getAttribute('data-section-id'), this.url = container.dataset.url, selectors.recommendations = `Recommendations-${this.sectionId}`, theme.initWhenVisible({ element: container, callback: this.init.bind(this), threshold: 500 });
    } return Recommendations.prototype = Object.assign({}, Recommendations.prototype, { init() {
      const section = document.getElementById(selectors.recommendations); if (!(!section || section.dataset.enable === 'false')) {
        const id = section.dataset.productId; const limit = section.dataset.limit; const url = `${this.url}?section_id=product-recommendations&limit=${limit}&product_id=${id}`; if (Shopify.designMode) {
          const wrapper = section.querySelector(selectors.sectionClass); wrapper && (wrapper.innerHTML = '');
        }fetch(url).then((response) => {
          return response.text();
        }).then((html) => {
          const parser = new DOMParser(); const doc = parser.parseFromString(html, 'text/html'); const div = doc.querySelector(selectors.sectionClass); const placeholder = section.querySelector(selectors.placeholder); if (placeholder) {
            if (placeholder.innerHTML = '', !div) {
              this.container.classList.add('hide'), AOS && AOS.refreshHard(); return;
            }placeholder.appendChild(div), theme.reinitProductGridItem(section), document.dispatchEvent(new CustomEvent('recommendations:loaded', { detail: { section } })); const results = div.querySelectorAll(selectors.productResults); results.length === 0 && this.container.classList.add('hide');
          }
        });
      }
    } }), Recommendations;
  }()), theme.SlideshowSection = (function () {
    const selectors = { parallaxContainer: '.parallax-container' }; function SlideshowSection(container) {
      this.container = container; const sectionId = container.getAttribute('data-section-id'); if (this.slideshow = container.querySelector(`#Slideshow-${sectionId}`), this.namespace = `.${sectionId}`, this.initialIndex = 0, !!this.slideshow) {
        const sectionEl = container.parentElement; const sectionIndex = [].indexOf.call(sectionEl.parentElement.children, sectionEl); sectionIndex === 0 ? this.init() : theme.initWhenVisible({ element: this.container, callback: this.init.bind(this) });
      }
    } return SlideshowSection.prototype = Object.assign({}, SlideshowSection.prototype, { init() {
      const slides = this.slideshow.querySelectorAll('.slideshow__slide'); if (this.container.hasAttribute('data-immediate-load') ? (this.slideshow.classList.remove('loading', 'loading--delayed'), this.slideshow.classList.add('loaded')) : theme.loadImageSection(this.slideshow), slides.length > 1) {
        const sliderArgs = { prevNextButtons: this.slideshow.hasAttribute('data-arrows'), pageDots: this.slideshow.hasAttribute('data-dots'), fade: !0, setGallerySize: !1, initialIndex: this.initialIndex, autoPlay: this.slideshow.dataset.autoplay === 'true' ? Number.parseInt(this.slideshow.dataset.speed) : !1 }; this.flickity = new theme.Slideshow(this.slideshow, sliderArgs);
      } else {
        slides[0].classList.add('is-selected');
      } this.container.hasAttribute('data-parallax') && this.container.querySelectorAll(selectors.parallaxContainer).forEach((el, i) => {
        new theme.Parallax(el, { namespace: `${this.namespace}-parallax-${i}` });
      });
    }, forceReload() {
      this.onUnload(), this.init();
    }, onUnload() {
      this.flickity && typeof this.flickity.destroy == 'function' && this.flickity.destroy();
    }, onDeselect() {
      this.flickity && typeof this.flickity.play == 'function' && this.flickity.play();
    }, onBlockSelect(evt) {
      const slide = this.slideshow.querySelector(`.slideshow__slide--${evt.detail.blockId}`); const index = Number.parseInt(slide.dataset.index); this.flickity && typeof this.flickity.pause == 'function'
        ? (this.flickity.goToSlide(index), this.flickity.pause())
        : (this.initialIndex = index, setTimeout(() => {
            this.flickity && typeof this.flickity.pause == 'function' && this.flickity.pause();
          }, 1e3));
    }, onBlockDeselect() {
      this.flickity && typeof this.flickity.play == 'function' && this.flickity.args.autoPlay && this.flickity.play();
    } }), SlideshowSection;
  }()), theme.StoreAvailability = (function () {
    const selectors = { drawerOpenBtn: '.js-drawer-open-availability', modalOpenBtn: '.js-modal-open-availability', productTitle: '[data-availability-product-title]' }; function StoreAvailability(container) {
      this.container = container, this.baseUrl = container.dataset.baseUrl, this.productTitle = container.dataset.productName;
    } return StoreAvailability.prototype = Object.assign({}, StoreAvailability.prototype, { updateContent(variantId) {
      const variantSectionUrl = `${this.baseUrl}/variants/${variantId}/?section_id=store-availability`; const self2 = this; fetch(variantSectionUrl).then((response) => {
        return response.text();
      }).then(function (html) {
        if (html.trim() === '') {
          this.container.innerHTML = ''; return;
        }self2.container.innerHTML = html, self2.container.innerHTML = self2.container.firstElementChild.innerHTML, self2.container.querySelector(selectors.drawerOpenBtn) && (self2.drawer = new theme.Drawers('StoreAvailabilityDrawer', 'availability')), self2.container.querySelector(selectors.modalOpenBtn) && (self2.modal = new theme.Modals('StoreAvailabilityModal', 'availability')); const title = self2.container.querySelector(selectors.productTitle); title && (title.textContent = self2.productTitle);
      });
    } }), StoreAvailability;
  }()), theme.VideoSection = (function () {
    const selectors = { videoParent: '.video-parent-section' }; function videoSection(container) {
      this.container = container, this.sectionId = container.getAttribute('data-section-id'), this.namespace = `.video-${this.sectionId}`, this.videoObject, theme.initWhenVisible({ element: this.container, callback: this.init.bind(this), threshold: 500 });
    } return videoSection.prototype = Object.assign({}, videoSection.prototype, { init() {
      const dataDiv = this.container.querySelector('.video-div'); if (dataDiv) {
        const type = dataDiv.dataset.type; switch (type) {
          case 'youtube':var videoId = dataDiv.dataset.videoId; this.initYoutubeVideo(videoId); break; case 'vimeo':var videoId = dataDiv.dataset.videoId; this.initVimeoVideo(videoId); break; case 'mp4':this.initMp4Video(); break;
        }
      }
    }, initYoutubeVideo(videoId) {
      this.videoObject = new theme.YouTube(`YouTubeVideo-${this.sectionId}`, { videoId, videoParent: selectors.videoParent });
    }, initVimeoVideo(videoId) {
      this.videoObject = new theme.VimeoPlayer(`Vimeo-${this.sectionId}`, videoId, { videoParent: selectors.videoParent });
    }, initMp4Video() {
      const mp4Video = `Mp4Video-${this.sectionId}`; const mp4Div = document.getElementById(mp4Video); const parent = mp4Div.closest(selectors.videoParent); if (mp4Div) {
        parent.classList.add('loaded'); const playPromise = document.querySelector(`#${mp4Video}`).play(); playPromise !== void 0 && playPromise.then(() => {}).catch(() => {
          mp4Div.setAttribute('controls', ''), parent.classList.add('video-interactable');
        });
      }
    }, onUnload(evt) {
      const sectionId = evt.target.id.replace('shopify-section-', ''); this.videoObject && typeof this.videoObject.destroy == 'function' && this.videoObject.destroy();
    } }), videoSection;
  }()), theme.BackgroundImage = (function () {
    const selectors = { parallaxContainer: '.parallax-container' }; function backgroundImage(container) {
      if (this.container = container, !!container) {
        const sectionId = container.getAttribute('data-section-id'); this.namespace = `.${sectionId}`, theme.initWhenVisible({ element: this.container, callback: this.init.bind(this) });
      }
    } return backgroundImage.prototype = Object.assign({}, backgroundImage.prototype, { init() {
      if (theme.loadImageSection(this.container), this.container.dataset && this.container.dataset.parallax) {
        const parallaxContainer = this.container.querySelector(selectors.parallaxContainer); const args = { namespace: `${this.namespace}-parallax`, desktopOnly: !0 }; theme.parallaxSections[this.namespace] = new theme.Parallax(parallaxContainer, args);
      }
    }, onUnload(evt) {
      this.container && (theme.parallaxSections[this.namespace] && typeof theme.parallaxSections[this.namespace].destroy == 'function' && theme.parallaxSections[this.namespace].destroy(), delete theme.parallaxSections[this.namespace]);
    } }), backgroundImage;
  }()), theme.CollectionHeader = (function () {
    let hasLoadedBefore = !1; function CollectionHeader(container) {
      this.namespace = '.collection-header'; const heroImageContainer = container.querySelector('.collection-hero'); if (heroImageContainer) {
        if (hasLoadedBefore && this.checkIfNeedReload(), theme.loadImageSection(heroImageContainer), container.dataset && container.dataset.parallax) {
          const parallaxContainer = container.querySelector('.parallax-container'); const args = { namespace: `${this.namespace}-parallax` }; theme.parallaxSections[this.namespace] = new theme.Parallax(parallaxContainer, args);
        }
      } else {
        theme.settings.overlayHeader && theme.headerNav.disableOverlayHeader();
      }hasLoadedBefore = !0;
    } return CollectionHeader.prototype = Object.assign({}, CollectionHeader.prototype, { checkIfNeedReload() {
      if (Shopify.designMode && theme.settings.overlayHeader) {
        const header = document.querySelector('.header-wrapper'); header.classList.contains('header-wrapper--overlay') || location.reload();
      }
    }, onUnload() {
      theme.parallaxSections[this.namespace] && (theme.parallaxSections[this.namespace].destroy(), delete theme.parallaxSections[this.namespace]);
    } }), CollectionHeader;
  }()), theme.CollectionSidebar = (function () {
    const selectors = { sidebarId: 'CollectionSidebar', trigger: '.collection-filter__btn', mobileWrapper: '#CollectionInlineFilterWrap', filters: '.filter-wrapper', filterBar: '.collection-filter' }; const config = { isOpen: !1, namespace: '.collection-filters' }; function CollectionSidebar() {
      document.getElementById(selectors.sidebarId) && (document.addEventListener('filter:selected', this.close.bind(this)), this.init());
    } function getScrollFilterTop() {
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop; const elTop = document.querySelector(selectors.filterBar).getBoundingClientRect().top; return elTop + scrollTop;
    } function sizeDrawer() {
      const header = document.getElementById('HeaderWrapper').offsetHeight; const filters = document.querySelector(selectors.filterBar).offsetHeight; const max = window.innerHeight - header - filters; document.documentElement.style.setProperty('--maxFiltersHeight', `${max}px`);
    } return CollectionSidebar.prototype = Object.assign({}, CollectionSidebar.prototype, { init() {
      config.isOpen = !1, theme.a11y.unlockMobileScrolling(config.namespace), this.container = document.getElementById(selectors.sidebarId), this.trigger = document.querySelector(selectors.trigger), this.wrapper = document.querySelector(selectors.mobileWrapper), this.filters = this.wrapper.querySelector(selectors.filters), this.trigger.off('click'), this.trigger.on('click', this.toggle.bind(this));
    }, toggle() {
      config.isOpen ? this.close() : this.open();
    }, open() {
      sizeDrawer(); const scrollTo = getScrollFilterTop(); window.scrollTo({ top: scrollTo, behavior: 'smooth' }), this.trigger.classList.add('is-active'), theme.utils.prepareTransition(this.filters, () => {
        this.filters.classList.add('is-active');
      }), config.isOpen = !0, theme.a11y.lockMobileScrolling(config.namespace), window.on(`keyup${config.namespace}`, (evt) => {
        evt.keyCode === 27 && this.close();
      });
    }, close() {
      this.trigger.classList.remove('is-active'), theme.utils.prepareTransition(this.filters, () => {
        this.filters.classList.remove('is-active');
      }), config.isOpen = !1, theme.a11y.unlockMobileScrolling(config.namespace), window.off(`keyup${config.namespace}`);
    }, onSelect() {
      this.open();
    }, onDeselect() {
      this.close();
    } }), CollectionSidebar;
  }()), theme.Collection = (function () {
    let isAnimating = !1; const selectors = { sortSelect: '#SortBy', sortBtn: '.filter-sort', colorSwatchImage: '.grid-product__color-image', colorSwatch: '.color-swatch--with-image', viewChange: '.grid-view-btn', productGrid: '.product-grid', collectionGrid: '.collection-grid__wrapper', sidebar: '#CollectionSidebar', activeTagList: '.tag-list--active-tags', tags: '.tag-list input', activeTags: '.tag-list a', tagsForm: '.filter-form', filterBar: '.collection-filter', priceRange: '.price-range', trigger: '.collapsible-trigger', filters: '.filter-wrapper', sidebarWrapper: '#CollectionSidebarFilterWrap', inlineWrapper: '#CollectionInlineFilterWrap' }; const config = { mobileFiltersInPlace: !1 }; const classes = { activeTag: 'tag--active', removeTagParent: 'tag--remove', collapsibleContent: 'collapsible-content', isOpen: 'is-open' }; function Collection(container) {
      this.container = container, this.containerId = container.id, this.sectionId = container.getAttribute('data-section-id'), this.namespace = `.collection-${this.sectionId}`, this.isCollectionTemplate = this.container.dataset.collectionTemplate, this.ajaxRenderer = new theme.AjaxRenderer({ sections: [{ sectionId: this.sectionId, nodeId: 'CollectionAjaxContent' }], onReplace: this.onReplaceAjaxContent.bind(this), preserveParams: ['sort_by', 'q', 'options[prefix]', 'type'] }), this.init(container);
    } return Collection.prototype = Object.assign({}, Collection.prototype, { init(container) {
      config.mobileFiltersInPlace = !1, container || (this.container = document.getElementById(this.containerId)), this.isCollectionTemplate && (this.cloneFiltersOnMobile(), this.initSort(), this.initFilters(), this.initPriceRange(), this.initGridOptions(), this.sidebar = new theme.CollectionSidebar()), this.quickAdd = new theme.QuickAdd(this.container), this.quickShop = new theme.QuickShop(this.container), this.colorImages = this.container.querySelectorAll(selectors.colorSwatchImage), this.colorImages.length && (this.swatches = this.container.querySelectorAll(selectors.colorSwatch), this.colorSwatchHovering());
    }, initSort() {
      this.sortSelect = document.querySelector(selectors.sortSelect), this.sortBtns = document.querySelectorAll(selectors.sortBtn), (this.sortSelect || this.sortBtn) && this.initParams(), this.sortSelect && (this.defaultSort = this.getDefaultSortValue(), this.sortSelect.on(`change${this.namespace}`, this.onSortChange.bind(this))), this.sortBtns.length && this.sortBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          document.dispatchEvent(new Event('filter:selected')), this.queryParams.sort_by = btn.dataset.value, this.goToSortUrl();
        });
      });
    }, initParams() {
      if (this.queryParams = {}, location.search.length) {
        for (var aKeyValue, aCouples = location.search.substr(1).split('&'), i = 0; i < aCouples.length; i++) {
          aKeyValue = aCouples[i].split('='), aKeyValue.length > 1 && (this.queryParams[decodeURIComponent(aKeyValue[0])] = decodeURIComponent(aKeyValue[1]));
        }
      }
    }, getSortValue() {
      return this.sortSelect.value || this.defaultSort;
    }, getDefaultSortValue() {
      return this.sortSelect.getAttribute('data-default-sortby');
    }, onSortChange() {
      this.queryParams.sort_by = this.getSortValue(), this.goToSortUrl();
    }, goToSortUrl() {
      this.queryParams.page && delete this.queryParams.page, window.location.search = decodeURIComponent(new URLSearchParams(Object.entries(this.queryParams)));
    }, colorSwatchHovering() {
      this.swatches.forEach((swatch) => {
        swatch.addEventListener('mouseenter', () => {
          this.setActiveColorImage(swatch);
        }), swatch.addEventListener('touchstart', (evt) => {
          evt.preventDefault(), this.setActiveColorImage(swatch);
        }, { passive: !0 });
      });
    }, setActiveColorImage(swatch) {
      const id = swatch.dataset.variantId; const image = swatch.dataset.variantImage; this.colorImages.forEach((el) => {
        el.classList.remove('is-active');
      }), this.swatches.forEach((el) => {
        el.classList.remove('is-active');
      }); const imageEl = this.container.querySelector(`.grid-product__color-image--${id}`); imageEl.style.backgroundImage = `url(${image})`, imageEl.classList.add('is-active'), swatch.classList.add('is-active'); const variantUrl = swatch.dataset.url; const gridItem = swatch.closest('.grid-item__link'); gridItem.setAttribute('href', variantUrl);
    }, initGridOptions() {
      const grid = this.container.querySelector(selectors.productGrid); const viewBtns = this.container.querySelectorAll(selectors.viewChange); this.container.querySelectorAll(selectors.viewChange).forEach((btn) => {
        btn.addEventListener('click', () => {
          viewBtns.forEach((el) => {
            el.classList.remove('is-active');
          }), btn.classList.add('is-active'); const newView = btn.dataset.view; grid.dataset.view = newView, theme.cart.updateAttribute('product_view', newView), window.dispatchEvent(new Event('resize'));
        });
      });
    }, initFilters() {
      const tags = document.querySelectorAll(selectors.tags); tags.length && (document.addEventListener('matchSmall', this.cloneFiltersOnMobile.bind(this)), this.bindBackButton(), theme.config.stickyHeader && (this.setFilterStickyPosition(), document.addEventListener('headerStickyChange', theme.utils.debounce(500, this.setFilterStickyPosition)), window.on('resize', theme.utils.debounce(500, this.setFilterStickyPosition))), document.querySelectorAll(selectors.activeTags).forEach((tag) => {
        tag.addEventListener('click', this.onTagClick.bind(this));
      }), document.querySelectorAll(selectors.tagsForm).forEach((form) => {
        form.addEventListener('input', this.onFormSubmit.bind(this));
      }));
    }, initPriceRange() {
      document.querySelectorAll(selectors.priceRange).forEach(el => new theme.PriceRange(el, { onChange: this.renderFromFormData.bind(this) }));
    }, cloneFiltersOnMobile() {
      if (!config.mobileFiltersInPlace) {
        const sidebarWrapper = document.querySelector(selectors.sidebarWrapper); if (sidebarWrapper) {
          const filters = sidebarWrapper.querySelector(selectors.filters).cloneNode(!0); const inlineWrapper = document.querySelector(selectors.inlineWrapper); inlineWrapper.innerHTML = '', inlineWrapper.append(filters), theme.collapsibles.init(inlineWrapper), config.mobileFiltersInPlace = !0;
        }
      }
    }, renderActiveTag(parent, el) {
      const textEl = parent.querySelector('.tag__text'); parent.classList.contains(classes.activeTag)
        ? parent.classList.remove(classes.activeTag)
        : (parent.classList.add(classes.activeTag), el.closest('li').classList.contains(classes.removeTagParent)
            ? parent.remove()
            : document.querySelectorAll(selectors.activeTagList).forEach((list) => {
              const newTag = document.createElement('li'); const newTagLink = document.createElement('a'); newTag.classList.add('tag', 'tag--remove'), newTagLink.classList.add('btn', 'btn--small'), newTagLink.innerText = textEl.innerText, newTag.appendChild(newTagLink), list.appendChild(newTag);
            }));
    }, onTagClick(evt) {
      const el = evt.currentTarget; if (document.dispatchEvent(new Event('filter:selected')), el.classList.contains('no-ajax') || (evt.preventDefault(), isAnimating)) {
        return;
      } isAnimating = !0; const parent = el.parentNode; const newUrl = new URL(el.href); this.renderActiveTag(parent, el), this.updateScroll(!0), this.startLoading(), this.renderCollectionPage(newUrl.searchParams);
    }, onFormSubmit(evt) {
      const el = evt.target; if (document.dispatchEvent(new Event('filter:selected')), el.classList.contains('no-ajax') || (evt.preventDefault(), isAnimating)) {
        return;
      } isAnimating = !0; const parent = el.closest('li'); const formEl = el.closest('form'); const formData = new FormData(formEl); this.renderActiveTag(parent, el), this.updateScroll(!0), this.startLoading(), this.renderFromFormData(formData);
    }, onReplaceAjaxContent(newDom, section) {
      this.fetchOpenCollasibleFilters().forEach((selector) => {
        newDom.querySelectorAll(`[data-collapsible-id=${selector}]`).forEach(this.openCollapsible);
      }); const newContentEl = newDom.getElementById(section.nodeId); if (newContentEl) {
        document.getElementById(section.nodeId).innerHTML = newContentEl.innerHTML; const page = document.getElementById(section.nodeId); const countEl = page.querySelector('.collection-filter__item--count'); if (countEl) {
          const count = countEl.innerText; document.querySelectorAll('[data-collection-count]').forEach((el) => {
            el.innerText = count;
          });
        }
      }
    }, renderFromFormData(formData) {
      const searchParams = new URLSearchParams(formData); this.renderCollectionPage(searchParams);
    }, renderCollectionPage(searchParams, updateURLHash = !0) {
      if (window.location.href.includes('collections/vendors')) {
        const queryString = window.location.search; const vendor = new URLSearchParams(queryString).get('q'); vendor && searchParams.append('q', vendor);
      } this.ajaxRenderer.renderPage(window.location.pathname, searchParams, updateURLHash).then(() => {
        theme.sections.reinit('collection-template'), this.updateScroll(!1), this.initPriceRange(), theme.reinitProductGridItem(), isAnimating = !1;
      });
    }, updateScroll(animate) {
      let scrollTo = document.getElementById('CollectionAjaxContent').offsetTop; theme.config.stickyHeader && (scrollTo = scrollTo - document.querySelector('#SiteHeader').offsetHeight), theme.config.bpSmall || (scrollTo -= 10), animate ? window.scrollTo({ top: scrollTo, behavior: 'smooth' }) : window.scrollTo({ top: scrollTo });
    }, bindBackButton() {
      window.off(`popstate${this.namespace}`), window.on(`popstate${this.namespace}`, (state) => {
        if (state) {
          const newUrl = new URL(window.location.href); this.renderCollectionPage(newUrl.searchParams, !1);
        }
      });
    }, fetchOpenCollasibleFilters() {
      const openDesktopCollapsible = Array.from(document.querySelectorAll(`${selectors.sidebar} ${selectors.trigger}.${classes.isOpen}`)); const openMobileCollapsible = Array.from(document.querySelectorAll(`${selectors.inlineWrapper} ${selectors.trigger}.${classes.isOpen}`)); return [...openDesktopCollapsible, ...openMobileCollapsible].map(trigger => trigger.dataset.collapsibleId);
    }, openCollapsible(el) {
      el.classList.contains(classes.collapsibleContent) && (el.style.height = 'auto'), el.classList.add(classes.isOpen);
    }, setFilterStickyPosition() {
      const headerHeight = document.querySelector('.site-header').offsetHeight - 1; document.querySelector(selectors.filterBar).style.top = `${headerHeight}px`; const stickySidebar = document.querySelector('.grid__item--sidebar'); stickySidebar && (stickySidebar.style.top = `${headerHeight + 30}px`);
    }, startLoading() {
      document.querySelector(selectors.collectionGrid).classList.add('unload');
    }, forceReload() {
      this.init(this.container);
    } }), Collection;
  }()), theme.FooterSection = (function () {
    const selectors = { locale: '[data-disclosure-locale]', currency: '[data-disclosure-currency]' }; const ids = { mobileNav: 'MobileNav', footerNavWrap: 'FooterMobileNavWrap', footerNav: 'FooterMobileNav' }; function FooterSection(container) {
      this.container = container, this.localeDisclosure = null, this.currencyDisclosure = null, theme.initWhenVisible({ element: this.container, callback: this.init.bind(this), threshold: 1e3 });
    } return FooterSection.prototype = Object.assign({}, FooterSection.prototype, { init() {
      const localeEl = this.container.querySelector(selectors.locale); const currencyEl = this.container.querySelector(selectors.currency); localeEl && (this.localeDisclosure = new theme.Disclosure(localeEl)), currencyEl && (this.currencyDisclosure = new theme.Disclosure(currencyEl)), theme.config.bpSmall && this.initDoubleMobileNav(), theme.collapsibles.init(this.container);
    }, initDoubleMobileNav() {
      const menuPlaceholder = document.getElementById(ids.footerNavWrap); if (menuPlaceholder) {
        const mobileNav = document.getElementById(ids.mobileNav); const footerNav = document.getElementById(ids.footerNav); const clone = mobileNav.cloneNode(!0); const navEl = clone.querySelector('.slide-nav__wrapper'); footerNav.appendChild(navEl), new theme.MobileNav({ id: ids.footerNav, inHeader: !1 }), menuPlaceholder.classList.remove('hide');
      }
    }, onUnload() {
      this.localeDisclosure && this.localeDisclosure.destroy(), this.currencyDisclosure && this.currencyDisclosure.destroy();
    } }), FooterSection;
  }()), theme.HeaderSection = (function () {
    const selectors = { headerFooter: '#MobileNavFooter', footerMenus: '#FooterMenus' }; const namespace = '.header'; function HeaderSection(container) {
      this.container = container, this.sectionId = this.container.getAttribute('data-section-id'), this.init();
    } return HeaderSection.prototype = Object.assign({}, HeaderSection.prototype, { init() {
      Shopify && Shopify.designMode && (theme.sections.reinit('slideshow-section'), setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 500)), theme.headerNav.init(), theme.announcementBar.init(), theme.headerSearch.init(), document.body.classList.contains('template-cart') || new theme.HeaderCart(), new theme.MobileNav({ id: 'MobileNav', inHeader: !0 }), theme.config.bpSmall && this.cloneFooter(), window.on(`resize${namespace}`, theme.utils.debounce(300, theme.sizeDrawer));
    }, cloneFooter() {
      const headerFooter = document.querySelector(selectors.headerFooter); if (headerFooter) {
        const footerMenus = document.querySelector(selectors.footerMenus); const clone = footerMenus.cloneNode(!0); clone.id = '', headerFooter.appendChild(clone); const localizationForm = headerFooter.querySelector('.multi-selectors'); localizationForm && localizationForm.querySelectorAll('[data-disclosure-toggle]').forEach((el) => {
          const controls = el.getAttribute('aria-controls'); const describedby = el.getAttribute('aria-describedby'); el.setAttribute('aria-controls', `${controls}-header`), el.setAttribute('aria-describedby', `${describedby}-header`); const list = document.getElementById(controls); list && (list.id = `${controls}-header`); const label = document.getElementById(describedby); label && (label.id = `${describedby}-header`); const parent = el.parentNode; parent && new theme.Disclosure(parent);
        });
      }
    }, onUnload() {} }), HeaderSection;
  }()), theme.Toolbar = (function () {
    const selectors = { locale: '[data-disclosure-locale]', currency: '[data-disclosure-currency]' }; function Toolbar(container) {
      this.container = container, this.sectionId = this.container.getAttribute('data-section-id'), this.init();
    } return Toolbar.prototype = Object.assign({}, Toolbar.prototype, { init() {
      this.initDisclosures(), theme.announcementBar.init();
    }, initDisclosures() {
      const localeEl = this.container.querySelector(selectors.locale); const currencyEl = this.container.querySelector(selectors.currency); localeEl && (this.localeDisclosure = new theme.Disclosure(localeEl)), currencyEl && (this.currencyDisclosure = new theme.Disclosure(currencyEl));
    }, onBlockSelect(evt) {
      theme.announcementBar.onBlockSelect(evt.detail.blockId);
    }, onBlockDeselect() {
      theme.announcementBar.onBlockDeselect();
    }, onUnload() {
      theme.announcementBar.unload(), this.localeDisclosure && this.localeDisclosure.destroy(), this.currencyDisclosure && this.currencyDisclosure.destroy();
    } }), Toolbar;
  }()), theme.Product = (function () {
    const videoObjects = {}; const classes = { onSale: 'on-sale', disabled: 'disabled', isModal: 'is-modal', loading: 'loading', loaded: 'loaded', hidden: 'hide', interactable: 'video-interactable', visuallyHide: 'visually-invisible' }; const selectors = { productVideo: '.product__video', videoParent: '.product__video-wrapper', slide: '.product-main-slide', currentSlide: '.is-selected', startingSlide: '.starting-slide', variantType: '.variant-wrapper', blocks: '[data-product-blocks]', blocksHolder: '[data-blocks-holder]' }; function Product(container) {
      this.container = container; const sectionId = this.sectionId = container.getAttribute('data-section-id'); const productId = this.productId = container.getAttribute('data-product-id'); this.inModal = container.dataset.modal === 'true', this.modal, this.settings = { enableHistoryState: container.dataset.history === 'true' || !1, namespace: `.product-${sectionId}`, inventory: !1, inventoryThreshold: 10, modalInit: !1, hasImages: !0, imageSetName: null, imageSetIndex: null, currentImageSet: null, imageSize: '620x', currentSlideIndex: 0, videoLooping: container.dataset.videoLooping }, this.inModal && (this.settings.enableHistoryState = !1, this.settings.namespace = `.product-${sectionId}-modal`, this.modal = document.getElementById(`QuickShopModal-${productId}`)), this.selectors = { variantsJson: '[data-variant-json]', currentVariantJson: '[data-current-variant-json]', form: '.product-single__form', media: '[data-product-media-type-model]', closeMedia: '.product-single__close-media', photoThumbs: '[data-product-thumb]', thumbSlider: '[data-product-thumbs]', thumbScroller: '.product__thumbs--scroller', mainSlider: '[data-product-photos]', imageContainer: '[data-product-images]', productImageMain: '[data-product-image-main]', priceWrapper: '[data-product-price-wrap]', price: '[data-product-price]', comparePrice: '[data-compare-price]', savePrice: '[data-save-price]', priceA11y: '[data-a11y-price]', comparePriceA11y: '[data-compare-price-a11y]', unitWrapper: '[data-unit-price-wrapper]', unitPrice: '[data-unit-price]', unitPriceBaseUnit: '[data-unit-base]', sku: '[data-sku]', inventory: '[data-product-inventory]', incomingInventory: '[data-incoming-inventory]', colorLabel: '[data-variant-color-label]', addToCart: '[data-add-to-cart]', addToCartText: '[data-add-to-cart-text]', originalSelectorId: '[data-product-select]', singleOptionSelector: '[data-variant-input]', variantColorSwatch: '.variant__input--color-swatch', availabilityContainer: '[data-store-availability-holder]' }, this.cacheElements(), this.firstProductImage = this.cache.mainSlider.querySelector('img'), this.firstProductImage || (this.settings.hasImages = !1); const dataSetEl = this.cache.mainSlider.querySelector('[data-set-name]'); dataSetEl && (this.settings.imageSetName = dataSetEl.dataset.setName), this.init();
    } return Product.prototype = Object.assign({}, Product.prototype, { init() {
      this.inModal && (this.container.classList.add(classes.isModal), document.addEventListener(`modalOpen.QuickShopModal-${this.productId}`, this.openModalProduct.bind(this)), document.addEventListener(`modalClose.QuickShopModal-${this.productId}`, this.closeModalProduct.bind(this))), this.inModal || (this.formSetup(), this.productSetup(), this.videoSetup(), this.initProductSlider(), this.customMediaListners(), this.addIdToRecentlyViewed()), window.off(`quickadd:loaded:${this.sectionId}`), window.on(`quickadd:loaded:${this.sectionId}`, this.initQuickAddForm.bind(this));
    }, cacheElements() {
      this.cache = { form: this.container.querySelector(this.selectors.form), mainSlider: this.container.querySelector(this.selectors.mainSlider), thumbSlider: this.container.querySelector(this.selectors.thumbSlider), thumbScroller: this.container.querySelector(this.selectors.thumbScroller), productImageMain: this.container.querySelector(this.selectors.productImageMain), priceWrapper: this.container.querySelector(this.selectors.priceWrapper), comparePriceA11y: this.container.querySelector(this.selectors.comparePriceA11y), comparePrice: this.container.querySelector(this.selectors.comparePrice), price: this.container.querySelector(this.selectors.price), savePrice: this.container.querySelector(this.selectors.savePrice), priceA11y: this.container.querySelector(this.selectors.priceA11y) };
    }, formSetup() {
      this.initQtySelector(), this.initAjaxProductForm(), this.availabilitySetup(), this.initVariants(), this.settings.imageSetName && this.updateImageSet();
    }, availabilitySetup() {
      const container = this.container.querySelector(this.selectors.availabilityContainer); container && (this.storeAvailability = new theme.StoreAvailability(container));
    }, productSetup() {
      this.setImageSizes(), this.initImageZoom(), this.initModelViewerLibraries(), this.initShopifyXrLaunch(), window.SPR && (SPR.initDomEls(), SPR.loadBadges());
    }, setImageSizes() {
      if (this.settings.hasImages) {
        const currentImage = this.firstProductImage.currentSrc; currentImage && (this.settings.imageSize = theme.Images.imageSize(currentImage));
      }
    }, addIdToRecentlyViewed() {
      const id = this.container.getAttribute('data-product-id'); if (id) {
        const i = theme.recentlyViewedIds.indexOf(id); i > -1 && theme.recentlyViewedIds.splice(i, 1), theme.recentlyViewedIds.unshift(id), theme.config.hasLocalStorage && window.localStorage.setItem('recently-viewed', JSON.stringify(theme.recentlyViewedIds));
      }
    }, initVariants() {
      const variantJson = this.container.querySelector(this.selectors.variantsJson); if (variantJson) {
        this.variantsObject = JSON.parse(variantJson.innerHTML); const options = { container: this.container, enableHistoryState: this.settings.enableHistoryState, singleOptionSelector: this.selectors.singleOptionSelector, originalSelectorId: this.selectors.originalSelectorId, variants: this.variantsObject }; const swatches = this.container.querySelectorAll(this.selectors.variantColorSwatch); if (swatches.length && swatches.forEach((swatch) => {
          swatch.addEventListener('change', (evt) => {
            const color = swatch.dataset.colorName; const index = swatch.dataset.colorIndex; this.updateColorName(color, index);
          });
        }), this.variants = new theme.Variants(options), this.storeAvailability) {
          const variant_id = this.variants.currentVariant ? this.variants.currentVariant.id : this.variants.variants[0].id; this.storeAvailability.updateContent(variant_id), this.container.on(`variantChange${this.settings.namespace}`, this.updateAvailability.bind(this));
        } this.container.on(`variantChange${this.settings.namespace}`, this.updateCartButton.bind(this)), this.container.on(`variantImageChange${this.settings.namespace}`, this.updateVariantImage.bind(this)), this.container.on(`variantPriceChange${this.settings.namespace}`, this.updatePrice.bind(this)), this.container.on(`variantUnitPriceChange${this.settings.namespace}`, this.updateUnitPrice.bind(this)), this.container.querySelectorAll(this.selectors.sku).length && this.container.on(`variantSKUChange${this.settings.namespace}`, this.updateSku.bind(this)); const inventoryEl = this.container.querySelector(this.selectors.inventory); if (inventoryEl && (this.settings.inventory = !0, this.settings.inventoryThreshold = inventoryEl.dataset.threshold, this.container.on(`variantChange${this.settings.namespace}`, this.updateInventory.bind(this))), theme.settings.dynamicVariantsEnable) {
          const currentVariantJson = this.container.querySelector(this.selectors.currentVariantJson); if (currentVariantJson) {
            const variantType = this.container.querySelector(selectors.variantType); variantType && new theme.VariantAvailability({ container: this.container, namespace: this.settings.namespace, type: variantType.dataset.type, variantsObject: this.variantsObject, currentVariantObject: JSON.parse(currentVariantJson.innerHTML) });
          }
        } if (this.settings.imageSetName) {
          const variantWrapper = this.container.querySelector(`.variant-input-wrap[data-handle="${this.settings.imageSetName}"]`); variantWrapper ? (this.settings.imageSetIndex = variantWrapper.dataset.index, this.container.on(`variantChange${this.settings.namespace}`, this.updateImageSet.bind(this))) : this.settings.imageSetName = null;
        }
      }
    }, initQtySelector() {
      this.container.querySelectorAll('.js-qty__wrapper').forEach((el) => {
        new theme.QtySelector(el, { namespace: '.product' });
      });
    }, initAjaxProductForm() {
      theme.settings.cartType === 'dropdown' && new theme.AjaxProduct(this.cache.form, '.add-to-cart');
    }, updateColorName(color, index) {
      this.container.querySelector(`${this.selectors.colorLabel}[data-index="${index}"`).textContent = color;
    }, updateCartButton(evt) {
      const variant = evt.detail.variant; const cartBtn = this.container.querySelector(this.selectors.addToCart); const cartBtnText = this.container.querySelector(this.selectors.addToCartText); if (variant) {
        if (variant.available) {
          cartBtn.classList.remove(classes.disabled), cartBtn.disabled = !1; const defaultText = cartBtnText.dataset.defaultText; cartBtnText.textContent = defaultText;
        } else {
          cartBtn.classList.add(classes.disabled), cartBtn.disabled = !0, cartBtnText.textContent = theme.strings.soldOut;
        }
      } else {
        cartBtn.classList.add(classes.disabled), cartBtn.disabled = !0, cartBtnText.textContent = theme.strings.unavailable;
      }
    }, updatePrice(evt) {
      const variant = evt.detail.variant; if (variant) {
        if (this.cache.price || this.cacheElements(), this.cache.price.innerHTML = theme.Currency.formatMoney(variant.price, theme.settings.moneyFormat), variant.compare_at_price > variant.price) {
          this.cache.comparePrice.innerHTML = theme.Currency.formatMoney(variant.compare_at_price, theme.settings.moneyFormat), this.cache.priceWrapper.classList.remove(classes.hidden), this.cache.price.classList.add(classes.onSale), this.cache.comparePriceA11y && this.cache.comparePriceA11y.setAttribute('aria-hidden', 'false'), this.cache.priceA11y && this.cache.priceA11y.setAttribute('aria-hidden', 'false'); let savings = variant.compare_at_price - variant.price; theme.settings.saveType == 'percent' ? savings = `${Math.round(savings * 100 / variant.compare_at_price)}%` : savings = theme.Currency.formatMoney(savings, theme.settings.moneyFormat), this.cache.savePrice.classList.remove(classes.hidden), this.cache.savePrice.innerHTML = theme.strings.savePrice.replace('[saved_amount]', savings);
        } else {
          this.cache.priceWrapper && this.cache.priceWrapper.classList.add(classes.hidden), this.cache.savePrice.classList.add(classes.hidden), this.cache.price.classList.remove(classes.onSale), this.cache.comparePriceA11y && this.cache.comparePriceA11y.setAttribute('aria-hidden', 'true'), this.cache.priceA11y && this.cache.priceA11y.setAttribute('aria-hidden', 'true');
        }
      }
    }, updateUnitPrice(evt) {
      const variant = evt.detail.variant; variant && variant.unit_price ? (this.container.querySelector(this.selectors.unitPrice).innerHTML = theme.Currency.formatMoney(variant.unit_price, theme.settings.moneyFormat), this.container.querySelector(this.selectors.unitPriceBaseUnit).innerHTML = theme.Currency.getBaseUnit(variant), this.container.querySelector(this.selectors.unitWrapper).classList.remove(classes.hidden)) : this.container.querySelector(this.selectors.unitWrapper).classList.add(classes.hidden);
    }, imageSetArguments(variant) {
      var variant = variant || (this.variants ? this.variants.currentVariant : null); if (variant) {
        const setValue = this.settings.currentImageSet = this.getImageSetName(variant[this.settings.imageSetIndex]); const set = `${this.settings.imageSetName}_${setValue}`; return this.settings.currentSlideIndex = 0, { cellSelector: `[data-group="${set}"]`, imageSet: set, initialIndex: this.settings.currentSlideIndex };
      }
    }, updateImageSet(evt) {
      const variant = evt ? evt.detail.variant : this.variants ? this.variants.currentVariant : null; if (variant) {
        const setValue = this.getImageSetName(variant[this.settings.imageSetIndex]); this.settings.currentImageSet !== setValue && this.initProductSlider(variant);
      }
    }, updateImageSetThumbs(set) {
      this.cache.thumbSlider.querySelectorAll('.product__thumb-item').forEach((thumb) => {
        thumb.classList.toggle(classes.hidden, thumb.dataset.group !== set);
      });
    }, getImageSetName(string) {
      return string.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '').replace(/^-/, '');
    }, updateSku(evt) {
      const variant = evt.detail.variant; let newSku = ''; let hideSku = !0; variant && (variant.sku && (newSku = variant.sku, hideSku = !1), this.container.querySelectorAll(this.selectors.sku).forEach((el) => {
        el.classList.toggle(classes.hidden, hideSku), el.querySelector('[data-sku-id]').textContent = newSku;
      }));
    }, updateInventory(evt) {
      const variant = evt.detail.variant; if (!variant || !variant.inventory_management || variant.inventory_policy === 'continue') {
        this.toggleInventoryQuantity(variant, !1), this.toggleIncomingInventory(!1); return;
      } if (variant.inventory_management === 'shopify' && window.inventories && window.inventories[this.productId]) {
        const variantInventoryObject = window.inventories[this.productId][variant.id]; if (variantInventoryObject.policy === 'continue') {
          this.toggleInventoryQuantity(variant, !1), this.toggleIncomingInventory(!1); return;
        } const quantity = variantInventoryObject.quantity; let showInventory = !0; let showIncomingInventory = !1; (quantity <= 0 || quantity > this.settings.inventoryThreshold) && (showInventory = !1), this.toggleInventoryQuantity(variant, showInventory, quantity), !showInventory && variantInventoryObject.incoming === 'true' && quantity <= this.settings.inventoryThreshold && (showIncomingInventory = !0), this.toggleIncomingInventory(showIncomingInventory, variant.available, variantInventoryObject.next_incoming_date);
      }
    }, updateAvailability(evt) {
      const variant = evt.detail.variant; variant && this.storeAvailability.updateContent(variant.id);
    }, toggleInventoryQuantity(variant, show, qty) {
      this.settings.inventory || (show = !1); const el = this.container.querySelector(this.selectors.inventory); const salesPoint = el.closest('.product-block'); Number.parseInt(qty) <= Number.parseInt(this.settings.inventoryThreshold) ? (el.parentNode.classList.add('inventory--low'), el.textContent = theme.strings.stockLabel.replace('[count]', qty)) : (el.parentNode.classList.remove('inventory--low'), el.textContent = theme.strings.inStockLabel), variant && variant.available ? (el.parentNode.classList.remove(classes.hidden), salesPoint && salesPoint.classList.remove(classes.hidden)) : (el.parentNode.classList.add(classes.hidden), salesPoint && salesPoint.classList.add(classes.hidden));
    }, toggleIncomingInventory(show, available, date) {
      const el = this.container.querySelector(this.selectors.incomingInventory); const salesPoint = el.closest('.product-block'); if (el) {
        const textEl = el.querySelector('.js-incoming-text'); if (show) {
          let string = available ? theme.strings.willNotShipUntil.replace('[date]', date) : theme.strings.willBeInStockAfter.replace('[date]', date); date || (string = theme.strings.waitingForStock), el.classList.remove(classes.hidden), salesPoint && salesPoint.classList.remove(classes.hidden), textEl.textContent = string;
        } else {
          el.classList.add(classes.hidden);
        }
      }
    }, videoSetup() {
      const productVideos = this.cache.mainSlider.querySelectorAll(selectors.productVideo); if (!productVideos.length) {
        return !1;
      } productVideos.forEach((vid) => {
        const type = vid.dataset.videoType; type === 'youtube' ? this.initYoutubeVideo(vid) : type === 'mp4' && this.initMp4Video(vid);
      });
    }, initYoutubeVideo(div) {
      videoObjects[div.id] = new theme.YouTube(div.id, { videoId: div.dataset.youtubeId, videoParent: selectors.videoParent, autoplay: !1, style: div.dataset.videoStyle, loop: div.dataset.videoLoop, events: { onReady: this.youtubePlayerReady.bind(this), onStateChange: this.youtubePlayerStateChange.bind(this) } });
    }, youtubePlayerReady(evt) {
      const iframeId = evt.target.getIframe().id; if (videoObjects[iframeId]) {
        const obj = videoObjects[iframeId]; const player = obj.videoPlayer; obj.options.style !== 'sound' && player.mute(), obj.parent.classList.remove('loading'), obj.parent.classList.add('loaded'), this._isFirstSlide(iframeId) && obj.options.style !== 'sound' && player.playVideo();
      }
    }, _isFirstSlide(id) {
      return this.cache.mainSlider.querySelector(`${selectors.startingSlide} #${id}`);
    }, youtubePlayerStateChange(evt) {
      const iframeId = evt.target.getIframe().id; const obj = videoObjects[iframeId]; switch (evt.data) {
        case -1:obj.attemptedToPlay && obj.parent.classList.add('video-interactable'); break; case 0:obj && obj.options.loop === 'true' && obj.videoPlayer.playVideo(); break; case 3:obj.attemptedToPlay = !0; break;
      }
    }, initMp4Video(div) {
      videoObjects[div.id] = { id: div.id, type: 'mp4' }, this._isFirstSlide(div.id) && this.playMp4Video(div.id);
    }, stopVideos() {
      for (const [id, vid] of Object.entries(videoObjects)) {
        vid.videoPlayer ? typeof vid.videoPlayer.stopVideo == 'function' && vid.videoPlayer.stopVideo() : vid.type === 'mp4' && this.stopMp4Video(vid.id);
      }
    }, _getVideoType(video) {
      return video.getAttribute('data-video-type');
    }, _getVideoDivId(video) {
      return video.id;
    }, playMp4Video(id) {
      const player = this.container.querySelector(`#${id}`); const playPromise = player.play(); player.setAttribute('controls', ''), player.focus(), player.addEventListener('focusout', this.returnFocusToThumbnail.bind(this)), playPromise !== void 0 && playPromise.then(() => {}).catch((error) => {
        player.setAttribute('controls', ''), player.closest(selectors.videoParent).setAttribute('data-video-style', 'unmuted');
      });
    }, stopMp4Video(id) {
      const player = this.container.querySelector(`#${id}`); player.removeEventListener('focusout', this.returnFocusToThumbnail.bind(this)), player && typeof player.pause == 'function' && (player.removeAttribute('controls'), player.pause());
    }, returnFocusToThumbnail(evt) {
      if (evt.relatedTarget && evt.relatedTarget.classList.contains('product__thumb')) {
        const thumb = this.container.querySelector(`.product__thumb-item[data-index="${this.settings.currentSlideIndex}"] a`); thumb && thumb.focus();
      }
    }, initImageZoom() {
      const container = this.container.querySelector(this.selectors.imageContainer); if (container) {
        const imageZoom = new theme.Photoswipe(container, this.sectionId); container.addEventListener('photoswipe:afterChange', (evt) => {
          this.flickity && this.flickity.goToSlide(evt.detail.index);
        });
      }
    }, getThumbIndex(target) {
      return target.dataset.index;
    }, updateVariantImage(evt) {
      const variant = evt.detail.variant; const sizedImgUrl = theme.Images.getSizedImageUrl(variant.featured_media.preview_image.src, this.settings.imageSize); const newImage = this.container.querySelector(`.product__thumb[data-id="${variant.featured_media.id}"]`); const imageIndex = this.getThumbIndex(newImage); typeof imageIndex > 'u' || this.flickity && this.flickity.goToSlide(imageIndex);
    }, initProductSlider(variant) {
      if (this.cache.mainSlider.querySelectorAll(selectors.slide).length <= 1) {
        const slide = this.cache.mainSlider.querySelector(selectors.slide); slide && slide.classList.add('is-selected'); return;
      } if (this.flickity && typeof this.flickity.destroy == 'function' && this.flickity.destroy(), !variant) {
        const activeSlide = this.cache.mainSlider.querySelector(selectors.startingSlide); this.settings.currentSlideIndex = this._slideIndex(activeSlide);
      } let mainSliderArgs = { adaptiveHeight: !0, avoidReflow: !0, initialIndex: this.settings.currentSlideIndex, childNav: this.cache.thumbSlider, childNavScroller: this.cache.thumbScroller, childVertical: this.cache.thumbSlider.dataset.position === 'beside', pageDots: !0, wrapAround: !0, callbacks: { onInit: this.onSliderInit.bind(this), onChange: this.onSlideChange.bind(this) } }; if (this.settings.imageSetName) {
        const imageSetArgs = this.imageSetArguments(variant); mainSliderArgs = Object.assign({}, mainSliderArgs, imageSetArgs), this.updateImageSetThumbs(mainSliderArgs.imageSet);
      } this.flickity = new theme.Slideshow(this.cache.mainSlider, mainSliderArgs);
    }, onSliderInit(slide) {
      this.settings.imageSetName && this.prepMediaOnSlide(slide);
    }, onSlideChange(index) {
      if (this.flickity) {
        const prevSlide = this.cache.mainSlider.querySelector(`.product-main-slide[data-index="${this.settings.currentSlideIndex}"]`); const nextSlide = this.settings.imageSetName ? this.cache.mainSlider.querySelectorAll('.flickity-slider .product-main-slide')[index] : this.cache.mainSlider.querySelector(`.product-main-slide[data-index="${index}"]`); prevSlide.setAttribute('tabindex', '-1'), nextSlide.setAttribute('tabindex', 0), this.stopMediaOnSlide(prevSlide), this.prepMediaOnSlide(nextSlide), this.settings.currentSlideIndex = index;
      }
    }, stopMediaOnSlide(slide) {
      const video = slide.querySelector(selectors.productVideo); if (video) {
        const videoType = this._getVideoType(video); const videoId = this._getVideoDivId(video); if (videoType === 'youtube') {
          if (videoObjects[videoId].videoPlayer) {
            videoObjects[videoId].videoPlayer.stopVideo(); return;
          }
        } else if (videoType === 'mp4') {
          this.stopMp4Video(videoId); return;
        }
      } const currentMedia = slide.querySelector(this.selectors.media); currentMedia && currentMedia.dispatchEvent(new CustomEvent('mediaHidden', { bubbles: !0, cancelable: !0 }));
    }, prepMediaOnSlide(slide) {
      const video = slide.querySelector(selectors.productVideo); if (video) {
        this.flickity.reposition(); const videoType = this._getVideoType(video); const videoId = this._getVideoDivId(video); if (videoType === 'youtube') {
          if (videoObjects[videoId].videoPlayer && videoObjects[videoId].options.style !== 'sound') {
            videoObjects[videoId].videoPlayer.playVideo(); return;
          }
        } else {
          videoType === 'mp4' && this.playMp4Video(videoId);
        }
      } const nextMedia = slide.querySelector(this.selectors.media); nextMedia && (nextMedia.dispatchEvent(new CustomEvent('mediaVisible', { bubbles: !0, cancelable: !0 })), slide.querySelector('.shopify-model-viewer-ui__button').setAttribute('tabindex', 0), slide.querySelector('.product-single__close-media').setAttribute('tabindex', 0));
    }, _slideIndex(el) {
      return el.getAttribute('data-index');
    }, openModalProduct() {
      let initialized = !1; if (this.settings.modalInit) {
        initialized = !0;
      } else {
        this.blocksHolder = this.container.querySelector(selectors.blocksHolder); const url = this.blocksHolder.dataset.url; fetch(url).then((response) => {
          return response.text();
        }).then((html) => {
          const parser = new DOMParser(); const doc = parser.parseFromString(html, 'text/html'); const blocks = doc.querySelector(selectors.blocks); blocks.querySelectorAll('[id]').forEach((el) => {
            const val = el.getAttribute('id'); el.setAttribute('id', `${val}-modal`); const label = blocks.querySelector(`[for="${val}"]`); label && label.setAttribute('for', `${val}-modal`); const collapsibleTrigger = blocks.querySelector(`[aria-controls="${val}"]`); collapsibleTrigger && collapsibleTrigger.setAttribute('aria-controls', `${val}-modal`);
          }); const form = blocks.querySelector(this.selectors.form); const formId = form.getAttribute('id'); blocks.querySelectorAll('[form]').forEach((el) => {
            el.setAttribute('form', formId);
          }), this.blocksHolder.innerHTML = '', this.blocksHolder.append(blocks), this.blocksHolder.classList.add('product-form-holder--loaded'), this.cacheElements(), this.formSetup(), this.updateModalProductInventory(), Shopify && Shopify.PaymentButton && Shopify.PaymentButton.init(), theme.collapsibles.init(this.container), document.dispatchEvent(new CustomEvent('quickview:loaded', { detail: { productId: this.sectionId } }));
        }), this.productSetup(), this.videoSetup(), this.settings.imageSetName
          ? this.variants
            ? this.initProductSlider()
            : document.addEventListener('quickview:loaded', (evt) => {
              evt.detail.productId === this.sectionId && this.initProductSlider();
            })
          : this.initProductSlider(), this.customMediaListners(), this.addIdToRecentlyViewed(), this.settings.modalInit = !0;
      }document.dispatchEvent(new CustomEvent('quickview:open', { detail: { initialized, productId: this.sectionId } }));
    }, updateModalProductInventory() {
      window.inventories = window.inventories || {}, this.container.querySelectorAll('.js-product-inventory-data').forEach((el) => {
        const productId = el.dataset.productId; window.inventories[productId] = {}, el.querySelectorAll('.js-variant-inventory-data').forEach((el2) => {
          window.inventories[productId][el2.dataset.id] = { quantity: el2.dataset.quantity, policy: el2.dataset.policy, incoming: el2.dataset.incoming, next_incoming_date: el2.dataset.date };
        });
      });
    }, closeModalProduct() {
      this.stopVideos();
    }, initQuickAddForm() {
      this.updateModalProductInventory(), Shopify && Shopify.PaymentButton && Shopify.PaymentButton.init();
    }, initModelViewerLibraries() {
      const modelViewerElements = this.container.querySelectorAll(this.selectors.media); modelViewerElements.length < 1 || theme.ProductMedia.init(modelViewerElements, this.sectionId);
    }, initShopifyXrLaunch() {
      document.addEventListener('shopify_xr_launch', () => {
        const currentMedia = this.container.querySelector(`${this.selectors.productMediaWrapper}:not(.${self.classes.hidden})`); currentMedia.dispatchEvent(new CustomEvent('xrLaunch', { bubbles: !0, cancelable: !0 }));
      });
    }, customMediaListners() {
      document.querySelectorAll(this.selectors.closeMedia).forEach((el) => {
        el.addEventListener('click', () => {
          const slide = this.cache.mainSlider.querySelector(selectors.currentSlide); const media = slide.querySelector(this.selectors.media); media && media.dispatchEvent(new CustomEvent('mediaHidden', { bubbles: !0, cancelable: !0 }));
        });
      }); const modelViewers = this.container.querySelectorAll('model-viewer'); modelViewers.length && modelViewers.forEach((el) => {
        el.addEventListener('shopify_model_viewer_ui_toggle_play', (evt) => {
          this.mediaLoaded(evt);
        }), el.addEventListener('shopify_model_viewer_ui_toggle_pause', (evt) => {
          this.mediaUnloaded(evt);
        });
      });
    }, mediaLoaded(evt) {
      this.container.querySelectorAll(this.selectors.closeMedia).forEach((el) => {
        el.classList.remove(classes.hidden);
      }), this.flickity && this.flickity.setDraggable(!1);
    }, mediaUnloaded(evt) {
      this.container.querySelectorAll(this.selectors.closeMedia).forEach((el) => {
        el.classList.add(classes.hidden);
      }), this.flickity && this.flickity.setDraggable(!0);
    }, onUnload() {
      theme.ProductMedia.removeSectionModels(this.sectionId), this.flickity && typeof this.flickity.destroy == 'function' && this.flickity.destroy();
    } }), Product;
  }()), theme.RecentlyViewed = (function () {
    let init = !1; const maxProducts = 7; function RecentlyViewed(container) {
      container && (this.container = container, this.sectionId = this.container.getAttribute('data-section-id'), theme.initWhenVisible({ element: this.container, callback: this.init.bind(this), threshold: 600 }));
    } return RecentlyViewed.prototype = Object.assign({}, RecentlyViewed.prototype, { init() {
      if (!init) {
        if (init = !0, !theme.recentlyViewedIds.length) {
          this.container.classList.add('hide'); return;
        } this.outputContainer = document.getElementById(`RecentlyViewed-${this.sectionId}`); const currentId = this.container.getAttribute('data-product-id'); let url = `${theme.routes.search}?view=recently-viewed&type=product&q=`; let products = ''; let i = 0; theme.recentlyViewedIds.forEach((val) => {
          val !== currentId && (i >= maxProducts || (products += `id:${val} OR `, i++));
        }), url = url + encodeURIComponent(products), fetch(url).then((response) => {
          return response.text();
        }).then((html) => {
          const parser = new DOMParser(); const doc = parser.parseFromString(html, 'text/html'); const count = doc.querySelectorAll('.grid-product').length; if (count > 0) {
            const results = doc.querySelector('.product-grid'); this.outputContainer.append(results), new theme.QuickAdd(this.outputContainer), new theme.QuickShop(this.outputContainer);
          } else {
            this.container.classList.add('hide');
          }
        });
      }
    }, onUnload() {
      init = !1;
    } }), RecentlyViewed;
  }()), theme.VendorProducts = (function () {
    const maxProducts = 6; function VendorProducts(container) {
      container && (this.container = container, this.sectionId = this.container.getAttribute('data-section-id'), this.currentProduct = this.container.getAttribute('data-product-id'), theme.initWhenVisible({ element: this.container, callback: this.init.bind(this), threshold: 600 }));
    } return VendorProducts.prototype = Object.assign({}, VendorProducts.prototype, { init() {
      this.outputContainer = document.getElementById(`VendorProducts-${this.sectionId}`), this.vendor = this.container.getAttribute('data-vendor'); let url = `${theme.routes.collections}/vendors?view=vendor-ajax&q=${this.vendor}`; url = url.replace('//', '/'), fetch(url).then((response) => {
        return response.text();
      }).then((html) => {
        let count = 0; const products = []; const modals = []; const parser = new DOMParser(); const doc = parser.parseFromString(html, 'text/html'); const allProds = doc.querySelectorAll('.grid-product'); allProds.forEach((el) => {
          const id = el.dataset.productId; if (count !== maxProducts && id !== this.currentProduct) {
            const modal = doc.querySelector(`.modal[data-product-id="${id}"]`); modal && modals.push(modal), count++, products.push(el);
          }
        }), this.outputContainer.innerHTML = '', products.length === 0 ? this.container.classList.add('hide') : (this.outputContainer.classList.remove('hide'), this.outputContainer.append(...products), modals.length && (this.outputContainer.append(...modals), new theme.QuickShop(this.outputContainer)), new theme.QuickAdd(this.outputContainer));
      });
    } }), VendorProducts;
  }()), theme.Testimonials = (function () {
    const defaults = { adaptiveHeight: !0, avoidReflow: !0, pageDots: !0, prevNextButtons: !1 }; function Testimonials(container) {
      this.container = container, this.timeout; const sectionId = container.getAttribute('data-section-id'); this.slideshow = container.querySelector(`#Testimonials-${sectionId}`), this.namespace = `.testimonial-${sectionId}`, this.slideshow && theme.initWhenVisible({ element: this.container, callback: this.init.bind(this), threshold: 600 });
    } return Testimonials.prototype = Object.assign({}, Testimonials.prototype, { init() {
      this.slideshow.dataset.count <= 3 && (defaults.wrapAround = !1), this.flickity = new theme.Slideshow(this.slideshow, defaults), this.slideshow.dataset.count > 2 && (this.timeout = setTimeout(() => {
        this.flickity.goToSlide(1);
      }, 1e3));
    }, onUnload() {
      this.flickity && typeof this.flickity.destroy == 'function' && this.flickity.destroy();
    }, onDeselect() {
      this.flickity && typeof this.flickity.play == 'function' && this.flickity.play();
    }, onBlockSelect(evt) {
      const slide = this.slideshow.querySelector(`.testimonials-slide--${evt.detail.blockId}`); const index = Number.parseInt(slide.dataset.index); clearTimeout(this.timeout), this.flickity && typeof this.flickity.pause == 'function' && (this.flickity.goToSlide(index), this.flickity.pause());
    }, onBlockDeselect() {
      this.flickity && typeof this.flickity.play == 'function' && this.flickity.play();
    } }), Testimonials;
  }()), theme.isStorageSupported = function (type) {
    if (window.self !== window.top) {
      return !1;
    } const testKey = 'test'; let storage; type === 'session' && (storage = window.sessionStorage), type === 'local' && (storage = window.localStorage); try {
      return storage.setItem(testKey, '1'), storage.removeItem(testKey), !0;
    } catch {
      return !1;
    }
  }, theme.reinitProductGridItem = function (scope) {
    window.SPR && (SPR.initDomEls(), SPR.loadBadges()), theme.collapsibles.init();
  }, theme.sizeDrawer = function () {
    const header = document.getElementById('HeaderWrapper').offsetHeight; const max = window.innerHeight - header; document.documentElement.style.setProperty('--maxDrawerHeight', `${max}px`);
  }, theme.config.hasSessionStorage = theme.isStorageSupported('session'), theme.config.hasLocalStorage = theme.isStorageSupported('local'), theme.config.hasLocalStorage) {
    const recentIds = window.localStorage.getItem('recently-viewed'); recentIds && typeof recentIds !== void 0 && (theme.recentlyViewedIds = JSON.parse(recentIds));
  }theme.config.bpSmall = matchMedia(theme.config.mediaQuerySmall).matches, matchMedia(theme.config.mediaQuerySmall).addListener((mql) => {
    mql.matches ? (theme.config.bpSmall = !0, document.dispatchEvent(new CustomEvent('matchSmall'))) : (theme.config.bpSmall = !1, document.dispatchEvent(new CustomEvent('unmatchSmall')));
  }); function DOMready(callback) {
    document.readyState != 'loading' ? callback() : document.addEventListener('DOMContentLoaded', callback);
  }theme.initGlobals = function () {
    theme.collapsibles.init(), theme.videoModal(), theme.animationObserver();
  }, DOMready(() => {
    if (theme.sections = new theme.Sections(), theme.sections.register('slideshow-section', theme.SlideshowSection), theme.sections.register('header', theme.HeaderSection), theme.sections.register('toolbar', theme.Toolbar), theme.sections.register('product', theme.Product), theme.sections.register('password-header', theme.PasswordHeader), theme.sections.register('photoswipe', theme.Photoswipe), theme.sections.register('product-recommendations', theme.Recommendations), theme.sections.register('background-image', theme.BackgroundImage), theme.sections.register('testimonials', theme.Testimonials), theme.sections.register('video-section', theme.VideoSection), theme.sections.register('map', theme.Maps), theme.sections.register('footer-section', theme.FooterSection), theme.sections.register('store-availability', theme.StoreAvailability), theme.sections.register('recently-viewed', theme.RecentlyViewed), theme.sections.register('vendor-products', theme.VendorProducts), theme.sections.register('newsletter-popup', theme.NewsletterPopup), theme.sections.register('collection-header', theme.CollectionHeader), theme.sections.register('collection-template', theme.Collection), theme.initGlobals(), theme.rteInit(), theme.settings.isCustomerTemplate && theme.customerTemplates(), document.body.classList.contains('template-cart')) {
      const cartPageForm = document.getElementById('CartPageForm'); if (cartPageForm) {
        const cartForm = new theme.CartForm(cartPageForm); const recommendations = document.querySelector('.cart-recommendations[data-location="page"]'); recommendations && (new theme.QuickAdd(recommendations), new theme.QuickShop(recommendations)); const noteBtn = cartPageForm.querySelector('.add-note'); noteBtn && noteBtn.addEventListener('click', () => {
          noteBtn.classList.toggle('is-active'), cartPageForm.querySelector('.cart__note').classList.toggle('hide');
        }), document.addEventListener('ajaxProduct:added', (evt) => {
          cartForm.buildCart();
        });
      }
    } if (document.body.classList.contains('template-search')) {
      const searchGrid = document.querySelector('.search-grid'); if (searchGrid) {
        const searchProducts = searchGrid.querySelectorAll('.grid-product'); searchProducts.length && (new theme.QuickAdd(searchGrid), new theme.QuickShop(searchGrid));
      }
    }document.addEventListener('recommendations:loaded', (evt) => {
      evt && evt.detail && evt.detail.section && (new theme.QuickAdd(evt.detail.section), new theme.QuickShop(evt.detail.section));
    }), theme.pageTransitions(), document.dispatchEvent(new CustomEvent('page:loaded'));
  });
}());
// # sourceMappingURL=/cdn/shop/t/5/assets/theme.js.map?v=48217368444319427751679593007
