const instafeedApp = (function instafeedLoad() {
  const appDomain = 'instafeed.nfcube.com'; const cssVer = '4.7.0'; const Instafeed = (function () {
    function a(a) {
      let b, c; for (b in this.options = { target: 'insta-feed', feedLoaded: !1, account: '', hash: '', forceUpdate: !1, picturesLoaded: 0, slider: !0, sliderPage: 1, admin: window.location.hostname === appDomain, title: '', columns: 5 }, a) {
        c = a[b], this.options[b] = c;
      }
    } return a.prototype.run = function (a) {
      let b; if (b = this.options.target, b = document.getElementById(b), this.options.accessToken === '' && this.options.apiVersion === 4) {
        return b.innerHTML = '<div class=\'instafeed-container\' style=\'width:25%;padding-top:25%;\'><img class=\'js-lazy-image\' style=\'width:98%;height:98%;\' src=\'//instafeed.nfcube.com/assets/img/pixel.gif\' /></div></div><div class=\'instafeed-container\' style=\'width:25%;padding-top:25%;\'><img class=\'js-lazy-image\' style=\'width:98%;height:98%;\' src=\'//instafeed.nfcube.com/assets/img/pixel.gif\' /></div></div><div class=\'instafeed-container\' style=\'width:25%;padding-top:25%;\'><img class=\'js-lazy-image\' style=\'width:98%;height:98%;\' src=\'//instafeed.nfcube.com/assets/img/pixel.gif\' /></div></div><div class=\'instafeed-container\' style=\'width:25%;padding-top:25%;\'><img class=\'js-lazy-image\' style=\'width:98%;height:98%;\' src=\'//instafeed.nfcube.com/assets/img/pixel.gif\' /></div></div>', b.innerHTML += '<div><em><b>Connect your Instagram account to see your feed</b></em></div>', !1;
      } b.innerHTML = '<img src=\'//instafeed.nfcube.com/assets/img/loader.gif\' style=\'position:relative;height:11px;width:16px;\' alt=\'loading bar\' />'; const c = this; const d = new XMLHttpRequest(); return d.open('GET', a || this._buildUrl(), !0), d.onreadystatechange = function () {
        if (d.readyState === 4) {
          const a = d.status; a === 0 || a <= 200 && a < 400 ? c.parse(JSON.parse(d.responseText)) : console.log('error');
        }
      }, d.send(), !0;
    }, a.prototype.parse = function (a) {
      let b, c, d, e, f, g, h, k, l, m, n, o, p, q, r, s, t, u, v; if (u = this.options.target, u = document.getElementById(u), typeof a != 'object') {
        throw new Error('Invalid JSON response');
      } if (a.meta.code !== 200) {
        throw u.innerHTML = this.options.admin ? `<em>${a.meta.error_message}</em>` : '', new Error(`Error from API: ${a.meta.error_message}`);
      } if (a.meta.error_message) {
        throw u.innerHTML = `<em>${a.meta.error_message}</em>`, new Error(`Error from API: ${a.meta.error_message}`);
      } if (a.data.length === 0) {
        throw u.innerHTML = '<em>No images were returned from this Instagram account</em>', new Error('No images were returned from Instagram');
      } if (this.options.success !== null && typeof this.options.success == 'function' && this.options.success.call(this, a), typeof document != 'undefined' && document !== null) {
        o = a.data, f = document.createDocumentFragment(), g = '', m = '', p = '', v = document.createElement('div'); let w = u.clientWidth / this.options.columns * window.devicePixelRatio; let x = 'standard_resolution'; let y = this.options.limit; let z = Number.parseFloat(100 / this.options.columns).toFixed(6); const A = Number.parseInt(100 - this.options.space); isMobileDevice() && validateCharge(this.options.charge) && (w = u.clientWidth / this.options.columnsMobile * window.devicePixelRatio, z = Number.parseFloat(100 / this.options.columnsMobile).toFixed(6), y = this.options.limitMobile), w <= 150 ? x = 'thumbnail' : w <= 320 && (x = 'low_resolution'); let B = ''; let C = ''; validateCharge(this.options.charge) && Number.parseInt(this.options.likes) > 0 && Number.parseInt(this.options.apiVersion) !== 4 && (B = '<div class=\'likes\'><span style=\'padding-right: 5px;\'><svg width=\'10\' height=\'10\' xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 512 512\'><path d=\'M462.3 62.6C407.5 15.9 326 24.3 275.7 76.2L256 96.5l-19.7-20.3C186.1 24.3 104.5 15.9 49.7 62.6c-62.8 53.6-66.1 149.8-9.9 207.9l193.5 199.8c12.5 12.9 32.8 12.9 45.3 0l193.5-199.8c56.3-58.1 53-154.3-9.8-207.9z\' fill=\'white\'></path></svg></span>{{likes}}<!--<span style=\'width: 10px;padding-right: 5px;padding-left: 5px;\'><svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 576 512\'><path d=\'M416 192c0-88.4-93.1-160-208-160S0 103.6 0 192c0 34.3 14.1 65.9 38 92-13.4 30.2-35.5 54.2-35.8 54.5-2.2 2.3-2.8 5.7-1.5 8.7S4.8 352 8 352c36.6 0 66.9-12.3 88.7-25 32.2 15.7 70.3 25 111.3 25 114.9 0 208-71.6 208-160zm122 220c23.9-26 38-57.7 38-92 0-66.9-53.5-124.2-129.3-148.1.9 6.6 1.3 13.3 1.3 20.1 0 105.9-107.7 192-240 192-10.8 0-21.3-.8-31.7-1.9C207.8 439.6 281.8 480 368 480c41 0 79.1-9.2 111.3-25 21.8 12.7 52.1 25 88.7 25 3.2 0 6.1-1.9 7.3-4.8 1.3-2.9.7-6.3-1.5-8.7-.3-.3-22.4-24.2-35.8-54.5z\' fill=\'white\'></path></svg></span> {{comments}}--></div>', C = '<span><span style=\'padding-right: 5px;\'><svg width=\'10\' height=\'10\' xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 512 512\'><path d=\'M462.3 62.6C407.5 15.9 326 24.3 275.7 76.2L256 96.5l-19.7-20.3C186.1 24.3 104.5 15.9 49.7 62.6c-62.8 53.6-66.1 149.8-9.9 207.9l193.5 199.8c12.5 12.9 32.8 12.9 45.3 0l193.5-199.8c56.3-58.1 53-154.3-9.8-207.9z\' fill=\'grey\'></path></svg> {{likes}}</span> <!--<span>&#10078; {{comments}}</span>-->'); const D = `<div style='width:${A}%;height:${A}%;' class='instafeed-overlay {{video}}'>${B}</div>`; let E = `<div class='instafeed-container' style='width:${z}%;padding-top:${z}%;'><img class='js-lazy-image' style='width:${A}%;height:${A}%;' src='//${appDomain}/assets/img/pixel.gif' data-src='{{image}}' alt='{{captionAlt}} on Instagram' />${D}</div>`; let F = ''; for (Number.parseInt(this.options.openIg) === 1 ? E = `<a href='{{link}}' target='_blank' rel='noopener'>${E}</a>` : Number.parseInt(this.options.openIg) === 2 ? this.options.admin ? E = `<a href='${this.options.shopOrigin}/collections/all' target='_blank' rel='noopener'>${E}</a>` : E = `<a href='//${window.location.hostname}/collections/all'>${E}</a>` : Number.parseInt(this.options.openIg) === 3 && (this.options.admin && (F = `<div class='products-tagging'><object><a href='#{{id}}-${this.options.target}' id='search' data-picture-id='{{fullId}}'><b><button class='primary'>Tag Product</button></b></a></object></div><em id='tagging-{{fullId}}'></em>`), E = `<a href='#{{id}}-${this.options.target}'>${E}</a><div class='instafeed-lightbox' id='{{id}}-${this.options.target}'><div class='lightbox-instagram' role='dialog' aria-labelledby='{{id}}-${this.options.target}' aria-modal='true'><div class='instafeed-post-image'>{{imageFullHtml}}</div><div class='description'><div class='instafeed-header'><div class='close-button'><a style='height:25px;width:25px;display:block!important;position:relative;' aria-label='close button' href='#_' id='close-button-url'></a></div><object><a href='https://www.instagram.com/{{username}}' target='_blank' rel='noopener' tabindex='-1'><img src='//${appDomain}/assets/img/instagram-logo.png' data-feed-id='${this.options.target}' class='profile-picture js-lazy-image' data-src='{{userPicture}}' alt='instagram profile picture' /></a></object><object class='name-section'><a class='fullname' href='https://www.instagram.com/{{username}}/' target='_blank' rel='noopener'><div class='fullname instafeed-text' data-feed-id='${this.options.target}'>{{fullName}}</div><div class='username'>@{{username}}</div></a></object></div><hr><div class='box-content'><div class='sub-header'><div class='post-engagement'>${C}</div><div class='arrows'><object><a href='#{{minusId}}-${this.options.target}'><img src='//${appDomain}/assets/img/pixel.gif' alt='previous image' /></a></object><object><a href='#{{plusId}}-${this.options.target}'><img src='//${appDomain}/assets/img/pixel.gif' alt='next image' /></a></object></div></div>${F} {{taggedProduct}}<div class='instafeed-caption'>{{caption}}</div><div class='post-date'>{{date}} \u2022 <object><a href='{{link}}' target='_blank' rel='noopener' class='follow'>View on Instagram</a></object></div></div></div></div></div>`), h = 0, r = o.length; h < r; h++) {
          k = o[h]; var G = ''; var H = k.user.followers; if (l = k.images[x], typeof l != 'object') {
            throw e = `No image found for resolution: ${x}.`, new Error(e);
          } if (k.hasOwnProperty('tagged_products') && k.tagged_products.length > 0 && validateCharge(this.options.charge)) {
            var I = this.options.admin; var J = this.options.shopOrigin; var K = this.options.target; k.tagged_products.forEach((a) => {
              I ? (taggedProductUrl = `<object class='product-title'><a href='https://${J}/products/${a.handle}/' target='_blank' rel='noopener'>${a.title}</a><a href='#{{id}}-${K}' id='delete-product' data-picture-id='{{fullId}}' data-tagging-id='${a.id}'><div class='tagged-buy-button'>Delete</div></a></object>`, productImageUrl = `<object><a href='https://${J}/products/${a.handle}/' target='_blank' rel='noopener'><img class='js-lazy-image' src='https://${appDomain}/assets/img/pixel.gif' data-src='${a.image}' alt='product image' /></a></object>`) : !I && (taggedProductUrl = `<object class='product-title'><a href='//${window.location.hostname}/products/${a.handle}/'>${a.title}</a><a href='//${window.location.hostname}/products/${a.handle}'><button class='tagged-buy-button' tabindex='-1'>Shop Now</button></a></object>`, productImageUrl = `<object><a href='//${window.location.hostname}/products/${a.handle}/'><img class='js-lazy-image' src='https://${appDomain}/assets/img/pixel.gif' data-src='${a.image}' alt='product image' /></a></object>`), G += `<div class='tagged-products' id='{{fullId}}-${a.id}'>${productImageUrl} ${taggedProductUrl}</div>`;
            });
          } let L = ''; k.type === 'video' && k.hasOwnProperty('videos') ? (L = 'instafeed-video', imageFullHtml = `<video controls playsinline muted id="video-{{id}}-instafeed" preload="none" src="${k.videos.standard_resolution.url}"</video>`) : imageFullHtml = `<a href='#_' tabindex='-1'><img class='js-lazy-image' src='//instafeed.nfcube.com/assets/img/pixel.gif' data-src='${k.images.standard_resolution.url}' alt='{{captionAlt}}'></a>`, n = l.url, this.options.picturesLoaded++; var M = this.options.picturesLoaded === 1 ? y : this.options.picturesLoaded - 1; var N = this.options.picturesLoaded === y ? 1 : this.options.picturesLoaded + 1; if (this.options.slider > 0) {
            var O = isMobileDevice() && validateCharge(this.options.charge) ? this.options.columnsMobile : this.options.columns; var P = Math.ceil(this.options.picturesLoaded / O); const a = P * O; const b = (P - 1) * O + 1; var M = this.options.picturesLoaded === b ? a : this.options.picturesLoaded - 1; var N = this.options.picturesLoaded === a ? b : this.options.picturesLoaded + 1;
          } if (m = this._makeTemplate(E, { model: k, id: this.options.picturesLoaded, fullId: k.id, minusId: M, plusId: N, link: k.link, image: n, video: L, slider: this.options.slider ? 'display:none;' : '', username: k.user.username, fullName: k.user.full_name, userPicture: k.user.profile_picture, imageFullHtml, taggedProduct: G, date: timeConverter(k.created_time), caption: escapeHtml(this._getObjectProperty(k, 'caption.text')), captionAlt: escapeHtml(this._getObjectProperty(k, 'caption.text').substring(0, 100)), likes: shortenLargeNumber(k.likes.count, 1), comments: shortenLargeNumber(k.comments.count, 1), location: this._getObjectProperty(k, 'location.name') }), this.options.slider > 0) {
            let a = ''; this.options.picturesLoaded === 1 && (a = '<div style=\'position:relative;\'>'), m = `${a}<span class="slide-page" data-slide-page="${P}" >${m}</span>`;
          } if (g += m, this.options.picturesLoaded >= y || a.data.length === this.options.picturesLoaded) {
            this.options.slider > 0 && a.data.length > O && (g += '<div class="slider-arrow" onclick="instafeedSlide(1)" style="right:-15px;">&#10095;</div>', g += '<div class="slider-arrow" onclick="instafeedSlide(-1)" style="left:-15px;">&#10094;</div>', g += '</div>'); break;
          }u.addEventListener('swiped-left', () => {
            instafeedSlide(1);
          }), u.addEventListener('swiped-right', () => {
            instafeedSlide(-1);
          });
        } for (v.innerHTML = g, d = [], c = 0, b = v.childNodes.length; c < b;) {
          d.push(v.childNodes[c]), c += 1;
        } for (q = 0, s = d.length; q < s; q++) {
          t = d[q], f.appendChild(t);
        }u.innerHTML = ''; let Q = ''; if (validateCharge(this.options.charge) && this.options.apiVersion === 5 && Number.parseInt(this.options.showFollowers) > 0 && (Q = `<h3>${shortenLargeNumber(H)} followers`), this.options.title.length > 0) {
          const R = document.createElement('h2'); R.innerHTML = this.options.title + Q, u.insertBefore(R, u.firstChild);
        }u.appendChild(f);
      } return lazyLoading(), this.options.slider > 0 && instafeedSlide(0), !0;
    }, a.prototype._buildUrl = function () {
      let a, b; if (b = this.options.forceUpdate ? 1 : 0, this.options.apiVersion === 4) {
        var c = this.options.limitMobile > this.options.limit ? this.options.limitMobile : this.options.limit; a = `https://instafeed.nfcube.com/feed/v4?charge=${this.options.charge}&fu=${b}&limit=${c}&account=${this.options.shopOrigin}&fid=${this.options.feedId}&hash=${this.options.hash}`;
      } else if (this.options.apiVersion === 5) {
        var c = this.options.limitMobile > this.options.limit ? this.options.limitMobile : this.options.limit; a = `https://instafeed.nfcube.com/feed/v5?charge=${this.options.charge}&fu=${b}&limit=${c}&account=${this.options.shopOrigin}&fid=${this.options.feedId}&hash=${this.options.hash}`;
      } return a;
    }, a.prototype._makeTemplate = function (a, b) {
      let c, d, e, f, g; for (d = /\{{2}([\w[\].]+)\}{2}/, c = a; d.test(c);) {
        f = c.match(d)[1], g = (e = this._getObjectProperty(b, f)) === null ? '' : e, c = c.replace(d, () => {
          return `${g}`;
        });
      } return c;
    }, a.prototype._getObjectProperty = function (a, b) {
      let c, d; for (b = b.replace(/\[(\w+)\]/g, '.$1'), d = b.split('.'); d.length;) {
        if (c = d.shift(), a !== null && c in a) {
          a = a[c];
        } else {
          return null;
        }
      } return a;
    }, a;
  }()); function validateCharge(a) {
    return !!(Number.parseInt(a) > 0);
  } function escapeHtml(a) {
    return a && (a = a.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')), a;
  } function shortenLargeNumber(a, b) {
    for (var c, d = ['k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'], e = d.length - 1; e >= 0; e--) {
      if (c = 1e3 ** (e + 1), a <= -c || a >= c) {
        return +(a / c).toFixed(b) + d[e];
      }
    } return a;
  } function timeConverter(b) {
    const c = new Date(1e3 * b); const a = c.toLocaleDateString(navigator.language, { month: 'long', day: 'numeric' }); return a.toUpperCase();
  } function isMobileDevice() {
    return window.matchMedia('only screen and (max-width: 760px)').matches;
  } function lazyLoading() {
    function a(a) {
      return new Promise((b, c) => {
        const d = new Image(); d.src = a, d.onload = b, d.onerror = c;
      });
    } function b(b) {
      const c = b.dataset.src; return c.includes('https://')
        ? a(c).then(() => {
          d(b, c);
        }).catch((a) => {
          console.log(a);
        })
        : void 0;
    } function c(a) {
      g === 0 && f.disconnect(); for (let c, d = 0; d < a.length; d++) {
        c = a[d], c.intersectionRatio > 0 && (g--, f.unobserve(c.target), b(c.target));
      }
    } function d(a, b) {
      a.classList.add('js-lazy-image--handled'), a.src = b;
    } const e = document.querySelectorAll('.js-lazy-image'); let f; let g = e.length; if (!('IntersectionObserver' in window)) {
      (function (a) {
        for (let c, d = 0; d < a.length; d++) {
          c = a[d], b(c);
        }
      })(e);
    } else {
      f = new IntersectionObserver(c, { rootMargin: '100px 0px', threshold: 0.01 }); for (let a, b = 0; b < e.length; b++) {
        (a = e[b], !a.classList.contains('js-lazy-image--handled')) && f.observe(a);
      }
    }
  }(function (a, b) {
    return typeof define == 'function' && define.amd ? define([], b) : typeof module == 'object' && module.exports ? (module.exports = b(), module.exports) : (a.Instafeed = b(), a.Instafeed);
  })(this, () => {
    return Instafeed;
  }), (function () {
    if (document.currentScript !== null && !document.currentScript.src.includes(appDomain)) {
      return !1;
    } const a = document.createElement('link'); a.href = `https://instafeed.nfcube.com/cdn/instafeed-${cssVer}.css`, a.type = 'text/css', a.rel = 'stylesheet', a.media = 'screen,print', document.getElementsByTagName('head')[0].appendChild(a);
  }()), (function () {
    function a() {
      const a = location.hash.split('!').pop().replace('/', ''); if (b = document.getElementById(`video-${d.substring(d.lastIndexOf('#') + 1, d.lastIndexOf('-insta-feed'))}-instafeed`), c = document.getElementById(`video-${a.substring(a.lastIndexOf('#') + 1, a.lastIndexOf('-insta-feed'))}-instafeed`), b && (b.pause(), b.onplay = function () {
        a === '#_' && b.pause();
      }), d = a, a === '#_' || a.length === 0) {
        document.body.style.overflowY = 'visible', f && (!0 === e && (f.style.webkitTransform = 'translate3d(0, 0, 0)'), f.style.overflowY = 'visible');
      } else if (a.includes('-feed')) {
        function b(a) {
          const b = a.key === 'Tab' || a.keyCode === 9; b && (a.shiftKey ? document.activeElement === g && (i.focus(), a.preventDefault()) : document.activeElement === i && (g.focus(), a.preventDefault()));
        } const d = document.querySelector(`[id='${a.substring(1)}']`); const g = d.querySelectorAll('#close-button-url, .follow')[0]; const h = d.querySelectorAll('#close-button-url, .follow'); const i = h[h.length - 1]; if (document.removeEventListener('keydown', b, !1), document.addEventListener('keydown', b, !1), c && c.play(), f) {
          const a = getComputedStyle(f); a.webkitTransform !== 'none' && (f.style.webkitTransform = 'initial', e = !0, document.getElementById('insta-feed').scrollIntoView()), f.style.overflowY = 'hidden';
        }document.body.style.overflowY = 'hidden';
      }
    } let b; let c; var d = ''; var e = !1; var f = document.getElementById('PageContainer'); window.instafeedSlidePage = 1, window.instafeedSlide = function (a = 0) {
      instafeedSlidePage = Number.parseInt(instafeedSlidePage) + Number.parseInt(a); let b = document.body.querySelectorAll('#insta-feed'); Number.parseInt(b.length) === 0 && (b = document.body.querySelectorAll('.instafeed-shopify')), b[0].style.padding = '0 20px 0 20px'; const c = document.body.querySelectorAll('.slide-page'); let d = 0; for (let b = 0; b < c.length; b++) {
        const e = c[b].getAttribute('data-slide-page'); d < e && (d = e);
      }instafeedSlidePage <= 0 && (instafeedSlidePage = d), instafeedSlidePage > d && (instafeedSlidePage = 1); const f = document.body.querySelectorAll(`[data-slide-page="${instafeedSlidePage}"]`); c.forEach((a) => {
        a.style.display = 'none';
      }), f.forEach((a) => {
        a.style.display = 'initial';
      });
    }, window.addEventListener('hashchange', a, !1), !(function (b, c) {
      'use strict'; function f(b, d, e) {
        for (;b && b !== c.documentElement;) {
          const a = b.getAttribute(d); if (a) {
            return a;
          } b = b.parentNode;
        } return e;
      } typeof b.CustomEvent != 'function' && (b.CustomEvent = function (b, d) {
        d = d || { bubbles: !1, cancelable: !1, detail: void 0 }; const e = c.createEvent('CustomEvent'); return e.initCustomEvent(b, d.bubbles, d.cancelable, d.detail), e;
      }, b.CustomEvent.prototype = b.Event.prototype), c.addEventListener('touchstart', (a) => {
        a.target.getAttribute('data-swipe-ignore') === 'true' || (m = a.target, l = Date.now(), g = a.touches[0].clientX, h = a.touches[0].clientY, j = 0, k = 0);
      }, !1), c.addEventListener('touchmove', (a) => {
        if (g && h) {
          const b = a.touches[0].clientX; const c = a.touches[0].clientY; j = g - b, k = h - c;
        }
      }, !1), c.addEventListener('touchend', (a) => {
        if (m === a.target) {
          const i = Number.parseInt(f(m, 'data-swipe-threshold', '20'), 10); const e = Number.parseInt(f(m, 'data-swipe-timeout', '500'), 10); const n = Date.now() - l; let c = ''; const o = a.changedTouches || a.touches || []; if (Math.abs(j) > Math.abs(k) ? Math.abs(j) > i && n < e && (c = j > 0 ? 'swiped-left' : 'swiped-right') : Math.abs(k) > i && n < e && (c = k > 0 ? 'swiped-up' : 'swiped-down'), c != '') {
            const p = { dir: c.replace(/swiped-/, ''), xStart: Number.parseInt(g, 10), xEnd: Number.parseInt((o[0] || {}).clientX || -1, 10), yStart: Number.parseInt(h, 10), yEnd: Number.parseInt((o[0] || {}).clientY || -1, 10) }; m.dispatchEvent(new CustomEvent('swiped', { bubbles: !0, cancelable: !0, detail: p })), m.dispatchEvent(new CustomEvent(c, { bubbles: !0, cancelable: !0, detail: p }));
          }g = null, h = null, l = null;
        }
      }, !1); var g = null; var h = null; var j = null; var k = null; var l = null; var m = null;
    }(window, document));
  }()); if (document.getElementById('insta-feed') !== null) {
    const feed = new Instafeed({
      account: '',
      hash: 'd4a16c722fe431795b7fef4ba3d0017b',
      apiVersion: 4,
      shopOrigin: 'body-beautiful-day-spa.myshopify.com',
      title: 'Follow Our Instagram',
      openIg: 3,
      space: 1,
      likes: 1,
      showFollowers: 0,
      slider: 0,
      filter: '',
      public: 0,
      columns: 4,
      feedId: 0,
      columnsMobile: 0,
      limit: 8,
      limitMobile: 0,
      charge: '0',
    }); feed.run();
  } return instafeedLoad;
})(); document.addEventListener('shopify:section:load', () => {
  instafeedApp();
});
