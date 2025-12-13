/*
@license
Expanse by Archetype Themes (https://archetypethemes.co)

Plugins:
JavaScript Cookie       2.2.0
Flickity                2.2.2 with customizations by Archetype
Flickity Fade           1.0.0 with customizations by Archetype
Photoswipe              4.1.3
Photoswipe UI           4.1.2 with customizations by Archetype
noUiSlider              15.2.0

Lazysizes for image loading:
core                    4.0.2
respimg                 4.0.1
rias                    4.0.1
*/
/*! lazysizes respimg - v4.0.1 */
!(function (t, e) {
  const i = function () {
    e(t.lazySizes), t.removeEventListener('lazyunveilread', i, !0);
  }; e = e.bind(null, t, t.document), typeof module == 'object' && module.exports ? e(require('lazysizes'), require('../fix-ios-sizes/fix-ios-sizes')) : t.lazySizes ? i() : t.addEventListener('lazyunveilread', i, !0);
}(window, (t, e, i) => {
  'use strict'; let n; let o = i && i.cfg || t.lazySizesConfig; const r = e.createElement('img'); const s = 'sizes' in r && 'srcset' in r; const a = /\s+\d+h/g; const l = (function () {
    const t = /\s+(\d+)(w|h)\s+(\d+)(w|h)/; const i = Array.prototype.forEach; return function (n) {
      const o = e.createElement('img'); const r = function (e) {
        let i; const n = e.getAttribute(lazySizesConfig.srcsetAttr); n && (n.match(t) && ((i = RegExp.$2 == 'w' ? RegExp.$1 / RegExp.$3 : RegExp.$3 / RegExp.$1) && e.setAttribute('data-aspectratio', i)), e.setAttribute(lazySizesConfig.srcsetAttr, n.replace(a, '')));
      }; const s = function (t) {
        const e = t.target.parentNode; e && e.nodeName == 'PICTURE' && i.call(e.getElementsByTagName('source'), r), r(t.target);
      }; const l = function () {
        o.currentSrc && e.removeEventListener('lazybeforeunveil', s);
      }; n[1] && (e.addEventListener('lazybeforeunveil', s), o.onload = l, o.onerror = l, o.srcset = 'data:,a 1w 1h', o.complete && l());
    };
  }()); if (o || (o = {}, t.lazySizesConfig = o), o.supportsType || (o.supportsType = function (t) {
    return !t;
  }), !t.picturefill && !o.pf) {
    if (t.HTMLPictureElement && s) {
      return e.msElementsFromPoint && l(navigator.userAgent.match(/Edge\/(\d+)/)), void (o.pf = function () {});
    } o.pf = function (e) {
      let i, o; if (!t.picturefill) {
        for (i = 0, o = e.elements.length; o > i; i++) {
          n(e.elements[i]);
        }
      }
    }, n = (function () {
      const r = function (t, e) {
        return t.w - e.w;
      }; const l = /^\s*\d+(?:\.+\d*)?px\s*$/; const c = (function () {
        let t; const e = /(([^,\s].\S+)\s+(\d+)w)/g; const i = /\s/; const n = function (e, i, n, o) {
          t.push({ c: i, u: n, w: 1 * o });
        }; return function (o) {
          return t = [], (o = o.trim()).replace(a, '').replace(e, n), t.length || !o || i.test(o) || t.push({ c: o, u: o, w: 99 }), t;
        };
      }()); const u = function () {
        u.init || (u.init = !0, addEventListener('resize', (function () {
          let t; const i = e.getElementsByClassName('lazymatchmedia'); const o = function () {
            let t, e; for (t = 0, e = i.length; e > t; t++) {
 n(i[t]); 
} 
}; return function () {
            clearTimeout(t), t = setTimeout(o, 66);
          };
        }())));
      }; const d = function (e, n) {
        let r; let s = e.getAttribute('srcset') || e.getAttribute(o.srcsetAttr); !s && n && (s = e._lazypolyfill ? e._lazypolyfill._set : e.getAttribute(o.srcAttr) || e.getAttribute('src')), e._lazypolyfill && e._lazypolyfill._set == s || (r = c(s || ''), n && e.parentNode && (r.isPicture = e.parentNode.nodeName.toUpperCase() == 'PICTURE', r.isPicture && t.matchMedia && (i.aC(e, 'lazymatchmedia'), u())), r._set = s, Object.defineProperty(e, '_lazypolyfill', { value: r, writable: !0 }));
      }; const h = function (e) {
        const n = t.devicePixelRatio || 1; const o = i.getX && i.getX(e); return Math.min(o || n, 2.5, n);
      }; let p = function (e) {
        return t.matchMedia
          ? (p = function (t) {
              return !t || (matchMedia(t) || {}).matches;
            })(e)
          : !e;
      }; const f = function (t) {
        let e, n, s, a, c, u, f; if (d(a = t, !0), (c = a._lazypolyfill).isPicture) {
          for (n = 0, s = (e = t.parentNode.getElementsByTagName('source')).length; s > n; n++) {
 if (o.supportsType(e[n].getAttribute('type'), t) && p(e[n].getAttribute('media'))) {
            a = e[n], d(a), c = a._lazypolyfill; break;
          } 
} 
} return c.length > 1
          ? (f = a.getAttribute('sizes') || '', f = l.test(f) && Number.parseInt(f, 10) || i.gW(t, t.parentNode), c.d = h(t), !c.src || !c.w || c.w < f
              ? (c.w = f, u = (function (t) {
                  for (var e, i, n = t.length, o = t[n - 1], r = 0; n > r; r++) {
 if ((o = t[r]).d = o.w / t.w, o.d >= t.d) {
                    !o.cached && (e = t[r - 1]) && e.d > t.d - 0.13 * t.d ** 2.2 && (i = (e.d - 0.6) ** 1.6, e.cached && (e.d += 0.15 * i), e.d + (o.d - t.d) * i > t.d && (o = e)); break;
                  } 
} return o;
                }(c.sort(r))), c.src = u)
              : u = c.src)
          : u = c[0], u;
      }; const m = function (t) {
        if (!s || !t.parentNode || t.parentNode.nodeName.toUpperCase() == 'PICTURE') {
          const e = f(t); e && e.u && t._lazypolyfill.cur != e.u && (t._lazypolyfill.cur = e.u, e.cached = !0, t.setAttribute(o.srcAttr, e.u), t.setAttribute('src', e.u));
        }
      }; return m.parse = c, m;
    }()), o.loadedClass && o.loadingClass && (function () {
      const t = []; ['img[sizes$="px"][srcset].', 'picture > img:not([srcset]).'].forEach((e) => {
        t.push(e + o.loadedClass), t.push(e + o.loadingClass);
      }), o.pf({ elements: e.querySelectorAll(t.join(', ')) });
    }());
  }
})), (function (t, e) {
  const i = function () {
    e(t.lazySizes), t.removeEventListener('lazyunveilread', i, !0);
  }; e = e.bind(null, t, t.document), typeof module == 'object' && module.exports ? e(require('lazysizes')) : t.lazySizes ? i() : t.addEventListener('lazyunveilread', i, !0);
}(window, (t, e, i) => {
  'use strict'; function n(e, i) {
    let n; let o; let r; let s; const a = t.getComputedStyle(e); for (n in o = e.parentNode, s = { isPicture: !(!o || !d.test(o.nodeName || '')) }, r = function (t, i) {
      let n = e.getAttribute(`data-${t}`); if (!n) {
        const o = a.getPropertyValue(`--ls-${t}`); o && (n = o.trim());
      } if (n) {
        if (n == 'true') {
          n = !0;
        } else if (n == 'false') {
          n = !1;
        } else if (u.test(n)) {
          n = Number.parseFloat(n);
        } else if (typeof l[t] == 'function') {
          n = l[t](e, n);
        } else if (m.test(n)) {
          try {
            n = JSON.parse(n);
          } catch (t) {}
        }s[t] = n;
      } else {
        t in l && typeof l[t] != 'function' ? s[t] = l[t] : i && typeof l[t] == 'function' && (s[t] = l[t](e, n));
      }
    }, l) {
      r(n);
    } return i.replace(f, (t, e) => {
      e in s || r(e, !0);
    }), s;
  } function o(t, i, n) {
    let o = 0; let r = 0; let s = n; if (t) {
      if (i.ratio === 'container') {
        for (o = s.scrollWidth, r = s.scrollHeight; !(o && r || s === e);) {
          o = (s = s.parentNode).scrollWidth, r = s.scrollHeight;
        }o && r && (i.ratio = r / o);
      }(t = (function (t, e) {
        const i = []; return i.srcset = [], e.absUrl && (v.setAttribute('href', t), t = v.href), t = ((e.prefix || '') + t + (e.postfix || '')).replace(f, (t, i) => {
          return c[typeof e[i]] ? e[i] : t;
        }), e.widths.forEach((n) => {
          const o = e.widthmap[n] || n; const r = { u: t.replace(h, o).replace(p, e.ratio ? Math.round(n * e.ratio) : ''), w: n }; i.push(r), i.srcset.push(r.c = `${r.u} ${n}w`);
        }), i;
      }(t, i))).isPicture = i.isPicture, x && n.nodeName.toUpperCase() == 'IMG' ? n.removeAttribute(a.srcsetAttr) : n.setAttribute(a.srcsetAttr, t.srcset.join(', ')), Object.defineProperty(n, '_lazyrias', { value: t, writable: !0 });
    }
  } function r(t, e) {
    const o = n(t, e); return l.modifyOptions.call(t, { target: t, details: o, detail: o }), i.fire(t, 'lazyriasmodifyoptions', o), o;
  } function s(t) {
    return t.getAttribute(t.getAttribute('data-srcattr') || l.srcAttr) || t.getAttribute(a.srcsetAttr) || t.getAttribute(a.srcAttr) || t.getAttribute('data-pfsrcset') || '';
  } let a; let l; var c = { string: 1, number: 1 }; var u = /^-*\+*\d+(?:\.+\d*)?$/; var d = /^picture$/i; var h = /\s*\{\s*width\s*\}\s*/i; var p = /\s*\{\s*height\s*\}\s*/i; var f = /\s*\{\s*([a-z0-9]+)\s*\}\s*/gi; var m = /^\[.*\]|\{.*\}$/; const g = /^(?:auto|\d+(px)?)$/; var v = e.createElement('a'); const y = e.createElement('img'); var x = 'srcset' in y && !('sizes' in y); const b = !!t.HTMLPictureElement && !x; !(function () {
    let e; const n = { prefix: '', postfix: '', srcAttr: 'data-src', absUrl: !1, modifyOptions() {}, widthmap: {}, ratio: !1 }; for (e in (a = i && i.cfg || t.lazySizesConfig) || (a = {}, t.lazySizesConfig = a), a.supportsType || (a.supportsType = function (t) {
      return !t;
    }), a.rias || (a.rias = {}), 'widths' in (l = a.rias) || (l.widths = [], (function (t) {
      for (var e, i = 0; !e || e < 3e3;) {
        (i += 5) > 30 && (i += 1), e = 36 * i, t.push(e);
      }
    }(l.widths))), n) {
      e in l || (l[e] = n[e]);
    }
  }()), addEventListener('lazybeforesizes', (t) => {
    let e, n, c, u, d, p, f, m, v, y, x, S, C; if (t.detail.instance == i && (e = t.target, t.detail.dataAttr && !t.defaultPrevented && !l.disabled && (v = e.getAttribute(a.sizesAttr) || e.getAttribute('sizes')) && g.test(v))) {
      if (c = r(e, n = s(e)), x = h.test(c.prefix) || h.test(c.postfix), c.isPicture && (u = e.parentNode)) {
        for (p = 0, f = (d = u.getElementsByTagName('source')).length; f > p; p++) {
          (x || h.test(m = s(d[p]))) && (o(m, c, d[p]), S = !0);
        }
      }x || h.test(n) ? (o(n, c, e), S = !0) : S && ((C = []).srcset = [], C.isPicture = !0, Object.defineProperty(e, '_lazyrias', { value: C, writable: !0 })), S && (b ? e.removeAttribute(a.srcAttr) : v != 'auto' && (y = { width: Number.parseInt(v, 10) }, w({ target: e, detail: y })));
    }
  }, !0); var w = (function () {
    const n = function (t, e) {
      return t.w - e.w;
    }; const o = function (t, e) {
      let n; return !t._lazyrias && i.pWS && (n = i.pWS(t.getAttribute(a.srcsetAttr || ''))).length && (Object.defineProperty(t, '_lazyrias', { value: n, writable: !0 }), e && t.parentNode && (n.isPicture = t.parentNode.nodeName.toUpperCase() == 'PICTURE')), t._lazyrias;
    }; const r = function (e) {
      const n = t.devicePixelRatio || 1; const o = i.getX && i.getX(e); return Math.min(o || n, 2.4, n);
    }; const s = function (e, i) {
      let s, a, l, c, u, d; if ((u = e._lazyrias).isPicture && t.matchMedia) {
        for (a = 0, l = (s = e.parentNode.getElementsByTagName('source')).length; l > a; a++) {
 if (o(s[a]) && !s[a].getAttribute('type') && (!(c = s[a].getAttribute('media')) || (matchMedia(c) || {}).matches)) {
          u = s[a]._lazyrias; break;
        } 
} 
} return (!u.w || u.w < i) && (u.w = i, u.d = r(e), d = (function (t) {
        for (var e, i, n = t.length, o = t[n - 1], r = 0; n > r; r++) {
 if ((o = t[r]).d = o.w / t.w, o.d >= t.d) {
          !o.cached && (e = t[r - 1]) && e.d > t.d - 0.13 * t.d ** 2.2 && (i = (e.d - 0.6) ** 1.6, e.cached && (e.d += 0.15 * i), e.d + (o.d - t.d) * i > t.d && (o = e)); break;
        } 
} return o;
      }(u.sort(n)))), d;
    }; let l = function (n) {
      if (n.detail.instance == i) {
        let r; const c = n.target; return !x && (t.respimage || t.picturefill || lazySizesConfig.pf)
          ? void e.removeEventListener('lazybeforesizes', l)
          : void (('_lazyrias' in c || n.detail.dataAttr && o(c, !0)) && (r = s(c, n.detail.width), r && r.u && c._lazyrias.cur != r.u && (c._lazyrias.cur = r.u, r.cached = !0, i.rAF(() => {
            c.setAttribute(a.srcAttr, r.u), c.setAttribute('src', r.u);
          }))));
      }
    }; return b ? l = function () {} : addEventListener('lazybeforesizes', l), l;
  }());
})), (function (t, e) {
  const i = (function (t, e) {
    'use strict'; if (e.getElementsByClassName) {
      let i; let n; const o = e.documentElement; const r = t.Date; const s = t.HTMLPictureElement; const a = 'addEventListener'; const l = 'getAttribute'; const c = t[a]; const u = t.setTimeout; const d = t.requestAnimationFrame || u; const h = t.requestIdleCallback; const p = /^picture$/i; const f = ['load', 'error', 'lazyincluded', '_lazyloaded']; const m = {}; const g = Array.prototype.forEach; const v = function (t, e) {
        return m[e] || (m[e] = new RegExp(`(\\s|^)${e}(\\s|$)`)), m[e].test(t[l]('class') || '') && m[e];
      }; const y = function (t, e) {
        v(t, e) || t.setAttribute('class', `${(t[l]('class') || '').trim()} ${e}`);
      }; const x = function (t, e) {
        let i; (i = v(t, e)) && t.setAttribute('class', (t[l]('class') || '').replace(i, ' '));
      }; const b = function (t, e, i) {
        const n = i ? a : 'removeEventListener'; i && b(t, e), f.forEach((i) => {
          t[n](i, e);
        });
      }; const w = function (t, n, o, r, s) {
        const a = e.createEvent('CustomEvent'); return o || (o = {}), o.instance = i, a.initCustomEvent(n, !r, !s, o), t.dispatchEvent(a), a;
      }; const S = function (e, i) {
        let o; !s && (o = t.picturefill || n.pf) ? o({ reevaluate: !0, elements: [e] }) : i && i.src && (e.src = i.src);
      }; const C = function (t, e) {
        return (getComputedStyle(t, null) || {})[e];
      }; const E = function (t, e, i) {
        for (i = i || t.offsetWidth; i < n.minSize && e && !t._lazysizesWidth;) {
          i = e.offsetWidth, e = e.parentNode;
        } return i;
      }; const D = (function () {
        let t; let i; const n = []; const o = []; let r = n; const s = function () {
 let e = r; for (r = n.length ? o : n, t = !0, i = !1; e.length;) { e.shift()(); }t = !1; 
}; const a = function (n, o) {
          t && !o ? n.apply(this, arguments) : (r.push(n), i || (i = !0, (e.hidden ? u : d)(s)));
        }; return a._lsFlush = s, a;
      }()); const P = function (t, e) {
        return e
          ? function () {
            D(t);
          }
          : function () {
            const e = this; const i = arguments; D(() => {
              t.apply(e, i);
            });
          };
      }; const z = function (t) {
        let e; let i = 0; const o = n.throttleDelay; let s = n.ricTimeout; const a = function () {
          e = !1, i = r.now(), t();
        }; const l = h && s > 49
          ? function () {
            h(a, { timeout: s }), s !== n.ricTimeout && (s = n.ricTimeout);
          }
          : P(() => {
            u(a);
          }, !0); return function (t) {
          let n; (t = !0 === t) && (s = 33), e || (e = !0, (n = o - (r.now() - i)) < 0 && (n = 0), t || n < 9 ? l() : u(l, n));
        };
      }; const A = function (t) {
        let e; let i; const n = function () {
          e = null, t();
        }; const o = function () {
          const t = r.now() - i; t < 99 ? u(o, 99 - t) : (h || n)(n);
        }; return function () {
          i = r.now(), e || (e = u(o, 99));
        };
      }; !(function () {
        let e; const i = { lazyClass: 'lazyload', loadedClass: 'lazyloaded', loadingClass: 'lazyloading', preloadClass: 'lazypreload', errorClass: 'lazyerror', autosizesClass: 'lazyautosizes', srcAttr: 'data-src', srcsetAttr: 'data-srcset', sizesAttr: 'data-sizes', minSize: 40, customMedia: {}, init: !0, expFactor: 1.5, hFac: 0.8, loadMode: 2, loadHidden: !0, ricTimeout: 0, throttleDelay: 125 }; for (e in n = t.lazySizesConfig || t.lazysizesConfig || {}, i) {
          e in n || (n[e] = i[e]);
        }t.lazySizesConfig = n, u(() => {
          n.init && k();
        });
      }()); const _ = (function () {
        let s; let d; let h; let f; let m; let E; let _; let k; let T; let M; let L; let F; let N; let O; const U = /^img$/i; const R = /^iframe$/i; const W = 'onscroll' in t && !/glebot/.test(navigator.userAgent); let V = 0; let H = 0; let B = -1; const j = function (t) {
          H--, t && t.target && b(t.target, j), (!t || H < 0 || !t.target) && (H = 0);
        }; const q = function (t, i) {
          let n; let r = t; let s = C(e.body, 'visibility') == 'hidden' || C(t, 'visibility') != 'hidden'; for (k -= i, L += i, T -= i, M += i; s && (r = r.offsetParent) && r != e.body && r != o;) {
 (s = (C(r, 'opacity') || 1) > 0) && 'visible' != C(r, 'overflow') && (n = r.getBoundingClientRect(), s = M > n.left && T < n.right && L > n.top - 1 && k < n.bottom + 1); 
} return s;
        }; const Z = function () {
          let t; let r; let a; let c; let u; let h; let p; let m; let g; const v = i.elements; if ((f = n.loadMode) && H < 8 && (t = v.length)) {
            r = 0, B++, N == null && ('expand' in n || (n.expand = o.clientHeight > 500 && o.clientWidth > 500 ? 500 : 370), F = n.expand, N = F * n.expFactor), V < N && H < 1 && B > 2 && f > 2 && !e.hidden ? (V = N, B = 0) : V = f > 1 && B > 1 && H < 6 ? F : 0; for (;r < t; r++) { if (v[r] && !v[r]._lazyRace) {if (W) if ((m = v[r][l]('data-expand')) && (h = 1 * m) || (h = V), g !== h && (E = innerWidth + h * O, _ = innerHeight + h, p = -1 * h, g = h), a = v[r].getBoundingClientRect(), (L = a.bottom) >= p && (k = a.top) <= _ && (M = a.right) >= p * O && (T = a.left) <= E && (L || M || T || k) && (n.loadHidden || "hidden" != C(v[r], "visibility")) && (d && H < 3 && !m && (f < 3 || B < 4) || q(v[r], h))) { if (Q(v[r]), u = !0, H > 9) break } else !u && d && !c && H < 4 && B < 4 && f > 2 && (s[0] || n.preloadAfterLoad) && (s[0] || !m && (L || M || T || k || "auto" != v[r][l](n.sizesAttr))) && (c = s[0] || v[r]); else {Q(v[r]);}}}c && !u && Q(c);
          }
        }; const X = z(Z); const G = function (t) {
          y(t.target, n.loadedClass), x(t.target, n.loadingClass), b(t.target, K), w(t.target, 'lazyloaded');
        }; const Y = P(G); var K = function (t) {
          Y({ target: t.target });
        }; const $ = function (t) {
          let e; const i = t[l](n.srcsetAttr); (e = n.customMedia[t[l]('data-media') || t[l]('media')]) && t.setAttribute('media', e), i && t.setAttribute('srcset', i);
        }; const J = P((t, e, i, o, r) => {
 let s, a, c, d, f, m; (f = w(t, 'lazybeforeunveil', e)).defaultPrevented || (o && (i ? y(t, n.autosizesClass) : t.setAttribute('sizes', o)), a = t[l](n.srcsetAttr), s = t[l](n.srcAttr), r && (d = (c = t.parentNode) && p.test(c.nodeName || '')), m = e.firesLoad || 'src' in t && (a || s || d), f = { target: t }, m && (b(t, j, !0), clearTimeout(h), h = u(j, 2500), y(t, n.loadingClass), b(t, K, !0)), d && g.call(c.getElementsByTagName('source'), $), a ? t.setAttribute('srcset', a) : s && !d && (R.test(t.nodeName) ? (function (t, e) { try { t.contentWindow.location.replace(e) } catch (i) { t.src = e } }(t, s)) : t.src = s), r && (a || d) && S(t, { src: s })), t._lazyRace && delete t._lazyRace, x(t, n.lazyClass), D(() =>{ (!m || t.complete && t.naturalWidth > 1) && (m ? j(f) : H--, G(f)) }, !0); 
}); var Q = function (t) {
          let e; const i = U.test(t.nodeName); const o = i && (t[l](n.sizesAttr) || t[l]('sizes')); const r = o == 'auto'; (!r && d || !i || !t[l]('src') && !t.srcset || t.complete || v(t, n.errorClass) || !v(t, n.lazyClass)) && (e = w(t, 'lazyunveilread').detail, r && I.updateElem(t, !0, t.offsetWidth), t._lazyRace = !0, H++, J(t, e, r, o, i));
        }; const tt = function () {
          if (!d) {
            if (r.now() - m < 999) {
 return void u(tt, 999); 
} const t = A(() => {
 n.loadMode = 3, X(); 
}); d = !0, n.loadMode = 3, X(), c('scroll', () => {
              n.loadMode == 3 && (n.loadMode = 2), t();
            }, !0);
          }
        }; return { _() {
          m = r.now(), i.elements = e.getElementsByClassName(n.lazyClass), s = e.getElementsByClassName(`${n.lazyClass} ${n.preloadClass}`), O = n.hFac, c('scroll', X, !0), c('resize', X, !0), t.MutationObserver ? new MutationObserver(X).observe(o, { childList: !0, subtree: !0, attributes: !0 }) : (o[a]('DOMNodeInserted', X, !0), o[a]('DOMAttrModified', X, !0), setInterval(X, 999)), c('hashchange', X, !0), ['focus', 'mouseover', 'click', 'load', 'transitionend', 'animationend', 'webkitAnimationEnd'].forEach((t) => {
            e[a](t, X, !0);
          }), /d$|^c/.test(e.readyState) ? tt() : (c('load', tt), e[a]('DOMContentLoaded', X), u(tt, 2e4)), i.elements.length ? (Z(), D._lsFlush()) : X();
        }, checkElems: X, unveil: Q };
      }()); var I = (function () {
        let t; const i = P((t, e, i, n) => {
 let o, r, s; if (t._lazysizesWidth = n, n += 'px', t.setAttribute('sizes', n), p.test(e.nodeName || '')) {for (r = 0, s = (o = e.getElementsByTagName('source')).length; r < s; r++){o[r].setAttribute("sizes",n);}}i.detail.dataAttr || S(t, i.detail); 
}); const o = function (t, e, n) {
          let o; const r = t.parentNode; r && (n = E(t, r, n), (o = w(t, 'lazybeforesizes', { width: n, dataAttr: !!e })).defaultPrevented || (n = o.detail.width) && n !== t._lazysizesWidth && i(t, r, o, n));
        }; const r = A(() => {
          let e; const i = t.length; if (i) { for (e = 0; e < i; e++) { o(t[e]) } } }); return { _() {
          t = e.getElementsByClassName(n.autosizesClass), c('resize', r);
        }, checkElems: r, updateElem: o };
      }()); var k = function () {
        k.i || (k.i = !0, I._(), _._());
      }; return i = { cfg: n, autoSizer: I, loader: _, init: k, uP: S, aC: y, rC: x, hC: v, fire: w, gW: E, rAF: D };
    }
  }(t, t.document)); t.lazySizes = i, typeof module == 'object' && module.exports && (module.exports = i);
}(window)), (function (t) {
  let e = !1; if (typeof define == 'function' && define.amd && (define(t), e = !0), typeof exports == 'object' && (module.exports = t(), e = !0), !e) {
    const i = window.Cookies; const n = window.Cookies = t(); n.noConflict = function () {
      return window.Cookies = i, n;
    };
  }
}(() => {
  function t() {
    for (var t = 0, e = {}; t < arguments.length; t++) {
      const i = arguments[t]; for (const n in i) {
        e[n] = i[n];
      }
    } return e;
  } return (function e(i) {
    function n(e, o, r) {
      let s; if (typeof document != 'undefined') {
        if (arguments.length > 1) {
          if (typeof (r = t({ path: '/' }, n.defaults, r)).expires == 'number') {
            const a = new Date(); a.setMilliseconds(a.getMilliseconds() + 864e5 * r.expires), r.expires = a;
          }r.expires = r.expires ? r.expires.toUTCString() : ''; try {
            s = JSON.stringify(o), /^[{[]/.test(s) && (o = s);
          } catch (t) {}o = i.write ? i.write(o, e) : encodeURIComponent(String(o)).replace(/%(23|24|26|2B|3A|3C|3E|3D|2F|3F|40|5B|5D|5E|60|7B|7D|7C)/g, decodeURIComponent), e = (e = (e = encodeURIComponent(String(e))).replace(/%(23|24|26|2B|5E|60|7C)/g, decodeURIComponent)).replace(/[()]/g, escape); let l = ''; for (const c in r) {
            r[c] && (l += `; ${c}`, !0 !== r[c] && (l += `=${r[c]}`));
          } return document.cookie = `${e}=${o}${l}`;
        }e || (s = {}); for (let u = document.cookie ? document.cookie.split('; ') : [], d = /(%[0-9A-Z]{2})+/g, h = 0; h < u.length; h++) {
          const p = u[h].split('='); let f = p.slice(1).join('='); this.json || f.charAt(0) !== '"' || (f = f.slice(1, -1)); try {
            const m = p[0].replace(d, decodeURIComponent); if (f = i.read ? i.read(f, m) : i(f, m) || f.replace(d, decodeURIComponent), this.json) {
              try {
                f = JSON.parse(f);
              } catch (t) {}
            } if (e === m) {
              s = f; break;
            }e || (s[m] = f);
          } catch (t) {}
        } return s;
      }
    } return n.set = n, n.get = function (t) {
      return n.call(n, t);
    }, n.getJSON = function () {
      return n.apply({ json: !0 }, [].slice.call(arguments));
    }, n.defaults = {}, n.remove = function (e, i) {
      n(e, '', t(i, { expires: -1 }));
    }, n.withConverter = e, n;
  }(() => {}));
})),
/*!
 * Flickity PACKAGED v2.2.2
 * Touch, responsive, flickable carousels
 *
 * Licensed GPLv3 for open source use
 * or Flickity Commercial License for commercial use
 *
 * https://flickity.metafizzy.co
 * Copyright 2015-2021 Metafizzy
 */
(function (t, e) {
  typeof define == 'function' && define.amd ? define('ev-emitter/ev-emitter', e) : typeof module == 'object' && module.exports ? module.exports = e() : t.EvEmitter = e();
}(typeof window != 'undefined' ? window : this, () => {
  function t() {} const e = t.prototype; return e.on = function (t, e) {
    if (t && e) {
      const i = this._events = this._events || {}; const n = i[t] = i[t] || []; return !n.includes(e) && n.push(e), this;
    }
  }, e.once = function (t, e) {
    if (t && e) {
      this.on(t, e); const i = this._onceEvents = this._onceEvents || {}; return (i[t] = i[t] || {})[e] = !0, this;
    }
  }, e.off = function (t, e) {
    const i = this._events && this._events[t]; if (i && i.length) {
      const n = i.indexOf(e); return n != -1 && i.splice(n, 1), this;
    }
  }, e.emitEvent = function (t, e) {
    let i = this._events && this._events[t]; if (i && i.length) {
      i = i.slice(0), e = e || []; for (let n = this._onceEvents && this._onceEvents[t], o = 0; o < i.length; o++) {
        const r = i[o]; n && n[r] && (this.off(t, r), delete n[r]), r.apply(this, e);
      } return this;
    }
  }, e.allOff = function () {
    delete this._events, delete this._onceEvents;
  }, t;
})),
/*!
 * getSize v2.0.3
 * measure size of elements
 * MIT license
 */
(function (t, e) {
  typeof define == 'function' && define.amd ? define('get-size/get-size', e) : typeof module == 'object' && module.exports ? module.exports = e() : t.getSize = e();
}(window, () => {
  'use strict'; function t(t) {
    const e = Number.parseFloat(t); return !t.includes('%') && !isNaN(e) && e;
  } const e = ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'marginLeft', 'marginRight', 'marginTop', 'marginBottom', 'borderLeftWidth', 'borderRightWidth', 'borderTopWidth', 'borderBottomWidth']; const i = e.length; function n(t) {
    return getComputedStyle(t);
  } let o; let r = !1; function s(a) {
    if ((function () {
      if (!r) {
        r = !0; const e = document.createElement('div'); e.style.width = '200px', e.style.padding = '1px 2px 3px 4px', e.style.borderStyle = 'solid', e.style.borderWidth = '1px 2px 3px 4px', e.style.boxSizing = 'border-box'; const i = document.body || document.documentElement; i.appendChild(e); const a = n(e); o = Math.round(t(a.width)) == 200, s.isBoxSizeOuter = o, i.removeChild(e);
      }
    }()), typeof a == 'string' && (a = document.querySelector(a)), a && typeof a == 'object' && a.nodeType) {
      const l = n(a); if (l.display == 'none') {
        return (function () {
          for (var t = { width: 0, height: 0, innerWidth: 0, innerHeight: 0, outerWidth: 0, outerHeight: 0 }, n = 0; n < i; n++) {
            t[e[n]] = 0;
          } return t;
        }());
      } const c = {}; c.width = a.offsetWidth, c.height = a.offsetHeight; for (var u = c.isBorderBox = l.boxSizing == 'border-box', d = 0; d < i; d++) {
        const h = e[d]; const p = l[h]; const f = Number.parseFloat(p); c[h] = isNaN(f) ? 0 : f;
      } const m = c.paddingLeft + c.paddingRight; const g = c.paddingTop + c.paddingBottom; const v = c.marginLeft + c.marginRight; const y = c.marginTop + c.marginBottom; const x = c.borderLeftWidth + c.borderRightWidth; const b = c.borderTopWidth + c.borderBottomWidth; const w = u && o; const S = t(l.width); !1 !== S && (c.width = S + (w ? 0 : m + x)); const C = t(l.height); return !1 !== C && (c.height = C + (w ? 0 : g + b)), c.innerWidth = c.width - (m + x), c.innerHeight = c.height - (g + b), c.outerWidth = c.width + v, c.outerHeight = c.height + y, c;
    }
  } return s;
})), (function (t, e) {
  'use strict'; typeof define == 'function' && define.amd ? define('desandro-matches-selector/matches-selector', e) : typeof module == 'object' && module.exports ? module.exports = e() : t.matchesSelector = e();
}(window, () => {
  'use strict'; const t = (function () {
    const t = window.Element.prototype; if (t.matches) {
      return 'matches';
    } if (t.matchesSelector) {
      return 'matchesSelector';
    } for (let e = ['webkit', 'moz', 'ms', 'o'], i = 0; i < e.length; i++) {
      const n = `${e[i]}MatchesSelector`; if (t[n]) {
        return n;
      }
    }
  }()); return function (e, i) {
    return e[t](i);
  };
})), (function (t, e) {
  typeof define == 'function' && define.amd
    ? define('fizzy-ui-utils/utils', ['desandro-matches-selector/matches-selector'], (i) => {
      return e(t, i);
    })
    : typeof module == 'object' && module.exports ? module.exports = e(t, require('desandro-matches-selector')) : t.fizzyUIUtils = e(t, t.matchesSelector);
}(window, (t, e) => {
  const i = { extend(t, e) {
    for (const i in e) {
      t[i] = e[i];
    } return t;
  }, modulo(t, e) {
    return (t % e + e) % e;
  } }; const n = Array.prototype.slice; return i.makeArray = function (t) {
    return Array.isArray(t) ? t : t == null ? [] : typeof t == 'object' && typeof t.length == 'number' ? n.call(t) : [t];
  }, i.removeFrom = function (t, e) {
    const i = t.indexOf(e); i != -1 && t.splice(i, 1);
  }, i.getParent = function (t, i) {
    for (;t.parentNode && t != document.body;) {
      if (t = t.parentNode, e(t, i)) {
        return t;
      }
    }
  }, i.getQueryElement = function (t) {
    return typeof t == 'string' ? document.querySelector(t) : t;
  }, i.handleEvent = function (t) {
    const e = `on${t.type}`; this[e] && this[e](t);
  }, i.filterFindElements = function (t, n) {
    t = i.makeArray(t); const o = []; return t.forEach((t) => {
      if (t instanceof HTMLElement) {
        if (n) {
          e(t, n) && o.push(t); for (let i = t.querySelectorAll(n), r = 0; r < i.length; r++) {
            o.push(i[r]);
          }
        } else {
          o.push(t);
        }
      }
    }), o;
  }, i.debounceMethod = function (t, e, i) {
    i = i || 100; const n = t.prototype[e]; const o = `${e}Timeout`; t.prototype[e] = function () {
      const t = this[o]; clearTimeout(t); const e = arguments; const r = this; this[o] = setTimeout(() => {
        n.apply(r, e), delete r[o];
      }, i);
    };
  }, i.docReady = function (t) {
    const e = document.readyState; e == 'complete' || e == 'interactive' ? setTimeout(t) : document.addEventListener('DOMContentLoaded', t);
  }, i.toDashed = function (t) {
    return t.replace(/(.)([A-Z])/g, (t, e, i) => {
      return `${e}-${i}`;
    }).toLowerCase();
  }, i.htmlInit = function (t, e) {
    i.docReady(() => {
      const n = i.toDashed(e); const o = `data-${n}`; const r = document.querySelectorAll(`[${o}]`); const s = document.querySelectorAll(`.js-${n}`); const a = i.makeArray(r).concat(i.makeArray(s)); const l = `${o}-options`; a.forEach((e) => {
        let i; const n = e.getAttribute(o) || e.getAttribute(l); try {
          i = n && JSON.parse(n);
        } catch (t) {
          return;
        } new t(e, i);
      });
    });
  }, i;
})), (function (t, e) {
  typeof define == 'function' && define.amd
    ? define('flickity/js/cell', ['get-size/get-size'], (i) => {
      return e(t, i);
    })
    : typeof module == 'object' && module.exports ? module.exports = e(t, require('get-size')) : (t.Flickity = t.Flickity || {}, t.Flickity.Cell = e(t, t.getSize));
}(window, (t, e) => {
  function i(t, e) {
    this.element = t, this.parent = e, this.create();
  } const n = i.prototype; return n.create = function () {
    this.element.style.position = 'absolute', this.element.setAttribute('aria-hidden', 'true'), this.x = 0, this.shift = 0;
  }, n.destroy = function () {
    this.unselect(), this.element.style.position = ''; const t = this.parent.originSide; this.element.style[t] = '', this.element.removeAttribute('aria-hidden');
  }, n.getSize = function () {
    this.size = e(this.element);
  }, n.setPosition = function (t) {
    this.x = t, this.updateTarget(), this.renderPosition(t);
  }, n.updateTarget = n.setDefaultTarget = function () {
    const t = this.parent.originSide == 'left' ? 'marginLeft' : 'marginRight'; this.target = this.x + this.size[t] + this.size.width * this.parent.cellAlign;
  }, n.renderPosition = function (t) {
    const e = this.parent.originSide; this.element.style[e] = this.parent.getPositionValue(t);
  }, n.select = function () {
    this.element.classList.add('is-selected'), this.element.removeAttribute('aria-hidden');
  }, n.unselect = function () {
    this.element.classList.remove('is-selected'), this.element.setAttribute('aria-hidden', 'true');
  }, n.wrapShift = function (t) {
    this.shift = t, this.renderPosition(this.x + this.parent.slideableWidth * t);
  }, n.remove = function () {
    this.element.parentNode.removeChild(this.element);
  }, i;
})), (function (t, e) {
  typeof define == 'function' && define.amd ? define('flickity/js/slide', e) : typeof module == 'object' && module.exports ? module.exports = e() : (t.Flickity = t.Flickity || {}, t.Flickity.Slide = e());
}(window, () => {
  'use strict'; function t(t) {
    this.parent = t, this.isOriginLeft = t.originSide == 'left', this.cells = [], this.outerWidth = 0, this.height = 0;
  } const e = t.prototype; return e.addCell = function (t) {
    if (this.cells.push(t), this.outerWidth += t.size.outerWidth, this.height = Math.max(t.size.outerHeight, this.height), this.cells.length == 1) {
      this.x = t.x; const e = this.isOriginLeft ? 'marginLeft' : 'marginRight'; this.firstMargin = t.size[e];
    }
  }, e.updateTarget = function () {
    const t = this.isOriginLeft ? 'marginRight' : 'marginLeft'; const e = this.getLastCell(); const i = e ? e.size[t] : 0; const n = this.outerWidth - (this.firstMargin + i); this.target = this.x + this.firstMargin + n * this.parent.cellAlign;
  }, e.getLastCell = function () {
    return this.cells[this.cells.length - 1];
  }, e.select = function () {
    this.cells.forEach((t) => {
      t.select();
    });
  }, e.unselect = function () {
    this.cells.forEach((t) => {
      t.unselect();
    });
  }, e.getCellElements = function () {
    return this.cells.map((t) => {
      return t.element;
    });
  }, t;
})), (function (t, e) {
  typeof define == 'function' && define.amd
    ? define('flickity/js/animate', ['fizzy-ui-utils/utils'], (i) => {
      return e(t, i);
    })
    : typeof module == 'object' && module.exports ? module.exports = e(t, require('fizzy-ui-utils')) : (t.Flickity = t.Flickity || {}, t.Flickity.animatePrototype = e(t, t.fizzyUIUtils));
}(window, (t, e) => {
  const i = { startAnimation() {
    this.isAnimating || (this.isAnimating = !0, this.restingFrames = 0, this.animate());
  }, animate() {
    this.applyDragForce(), this.applySelectedAttraction(); const t = this.x; if (this.integratePhysics(), this.positionSlider(), this.settle(t), this.isAnimating) {
      const e = this; requestAnimationFrame(() => {
        e.animate();
      });
    }
  }, positionSlider() {
    let t = this.x; this.options.wrapAround && this.cells.length > 1 && (t = e.modulo(t, this.slideableWidth), t -= this.slideableWidth, this.shiftWrapCells(t)), this.setTranslateX(t, this.isAnimating), this.dispatchScrollEvent();
  }, setTranslateX(t, e) {
    t += this.cursorPosition, t = this.options.rightToLeft ? -t : t; const i = this.getPositionValue(t); this.slider.style.transform = e ? `translate3d(${i},0,0)` : `translateX(${i})`;
  }, dispatchScrollEvent() {
    const t = this.slides[0]; if (t) {
      const e = -this.x - t.target; const i = e / this.slidesWidth; this.dispatchEvent('scroll', null, [i, e]);
    }
  }, positionSliderAtSelected() {
    this.cells.length && (this.x = -this.selectedSlide.target, this.velocity = 0, this.positionSlider());
  }, getPositionValue(t) {
    return this.options.percentPosition ? `${0.01 * Math.round(t / this.size.innerWidth * 1e4)}%` : `${Math.round(t)}px`;
  }, settle(t) {
    !this.isPointerDown && Math.round(100 * this.x) == Math.round(100 * t) && this.restingFrames++, this.restingFrames > 2 && (this.isAnimating = !1, delete this.isFreeScrolling, this.positionSlider(), this.dispatchEvent('settle', null, [this.selectedIndex]));
  }, shiftWrapCells(t) {
    const e = this.cursorPosition + t; this._shiftCells(this.beforeShiftCells, e, -1); const i = this.size.innerWidth - (t + this.slideableWidth + this.cursorPosition); this._shiftCells(this.afterShiftCells, i, 1);
  }, _shiftCells(t, e, i) {
    for (let n = 0; n < t.length; n++) {
      const o = t[n]; const r = e > 0 ? i : 0; o.wrapShift(r), e -= o.size.outerWidth;
    }
  }, _unshiftCells(t) {
    if (t && t.length) {
      for (let e = 0; e < t.length; e++) {
        t[e].wrapShift(0);
      }
    }
  }, integratePhysics() {
    this.x += this.velocity, this.velocity *= this.getFrictionFactor();
  }, applyForce(t) {
    this.velocity += t;
  }, getFrictionFactor() {
    return 1 - this.options[this.isFreeScrolling ? 'freeScrollFriction' : 'friction'];
  }, getRestingPosition() {
    return this.x + this.velocity / (1 - this.getFrictionFactor());
  }, applyDragForce() {
    if (this.isDraggable && this.isPointerDown) {
      const t = this.dragX - this.x - this.velocity; this.applyForce(t);
    }
  }, applySelectedAttraction() {
    if (!(this.isDraggable && this.isPointerDown) && !this.isFreeScrolling && this.slides.length) {
      const t = (-1 * this.selectedSlide.target - this.x) * this.options.selectedAttraction; this.applyForce(t);
    }
  } }; return i;
})), (function (t, e) {
  if (typeof define == 'function' && define.amd) {
    define('flickity/js/flickity', ['ev-emitter/ev-emitter', 'get-size/get-size', 'fizzy-ui-utils/utils', './cell', './slide', './animate'], (i, n, o, r, s, a) => {
      return e(t, i, n, o, r, s, a);
    });
  } else if (typeof module == 'object' && module.exports) {
    module.exports = e(t, require('ev-emitter'), require('get-size'), require('fizzy-ui-utils'), require('./cell'), require('./slide'), require('./animate'));
  } else {
    const i = t.Flickity; t.Flickity = e(t, t.EvEmitter, t.getSize, t.fizzyUIUtils, i.Cell, i.Slide, i.animatePrototype);
  }
}(window, (t, e, i, n, o, r, s) => {
  t.getComputedStyle; function a(t, e) {
    for (t = n.makeArray(t); t.length;) {
      e.appendChild(t.shift());
    }
  } let l = 0; const c = {}; function u(t, e) {
    const i = n.getQueryElement(t); if (i) {
      if (this.element = i, this.element.flickityGUID) {
        const o = c[this.element.flickityGUID]; return o && o.option(e), o;
      } this.options = n.extend({}, this.constructor.defaults), this.option(e), this._create();
    }
  }u.defaults = { accessibility: !0, adaptiveHeight: !1, cellAlign: 'center', freeScrollFriction: 0.075, friction: 0.28, initialIndex: 0, percentPosition: !0, resize: !0, selectedAttraction: 0.025, setGallerySize: !0, wrapAround: !1 }, u.createMethods = []; const d = u.prototype; n.extend(d, e.prototype), d._create = function () {
    const t = this.guid = ++l; for (const e in this.element.flickityGUID = t, c[t] = this, this.selectedIndex = 0, this.restingFrames = 0, this.x = 0, this.velocity = 0, this.originSide = this.options.rightToLeft ? 'right' : 'left', this.viewport = document.createElement('div'), this.viewport.className = 'flickity-viewport', this._createSlider(), this.options.on) {
      const i = this.options.on[e]; this.on(e, i);
    }u.createMethods.forEach(function (t) {
      this[t]();
    }, this), this.activate();
  }, d.option = function (t) {
    n.extend(this.options, t);
  }, d.activate = function () {
    this.isActive || (this.isActive = !0, this.element.classList.add('flickity-enabled'), this.options.rightToLeft && this.element.classList.add('flickity-rtl'), this.getSize(), a(this._filterFindCellElements(this.element.children), this.slider), this.viewport.appendChild(this.slider), this.element.appendChild(this.viewport), this.reloadCells(), this.options.accessibility && (this.element.tabIndex = 0, this.element.addEventListener('keydown', this)), this.emitEvent('activate'), this.selectInitialIndex(), this.isInitActivated = !0, this.dispatchEvent('ready', null, [this.element]));
  }, d._createSlider = function () {
    const t = document.createElement('div'); t.className = 'flickity-slider', t.style[this.originSide] = 0, this.slider = t;
  }, d._filterFindCellElements = function (t) {
    return n.filterFindElements(t, this.options.cellSelector);
  }, d.reloadCells = function () {
    this.cells = this._makeCells(this.slider.children), this.positionCells(), this._getWrapShiftCells(), this.setGallerySize();
  }, d._makeCells = function (t) {
    return this._filterFindCellElements(t).map(function (t) {
      return new o(t, this);
    }, this);
  }, d.getLastCell = function () {
    return this.cells[this.cells.length - 1];
  }, d.getLastSlide = function () {
    return this.slides[this.slides.length - 1];
  }, d.positionCells = function () {
    this._sizeCells(this.cells), this._positionCells(0);
  }, d._positionCells = function (t) {
    t = t || 0, this.maxCellHeight = t && this.maxCellHeight || 0; let e = 0; if (t > 0) {
      const i = this.cells[t - 1]; e = i.x + i.size.outerWidth;
    } for (var n = this.cells.length, o = t; o < n; o++) {
      const r = this.cells[o]; r.setPosition(e), e += r.size.outerWidth, this.maxCellHeight = Math.max(r.size.outerHeight, this.maxCellHeight);
    } this.slideableWidth = e, this.updateSlides(), this._containSlides(), this.slidesWidth = n ? this.getLastSlide().target - this.slides[0].target : 0;
  }, d._sizeCells = function (t) {
    t.forEach((t) => {
      t.getSize();
    });
  }, d.updateSlides = function () {
    if (this.slides = [], this.cells.length) {
      let t = new r(this); this.slides.push(t); const e = this.originSide == 'left' ? 'marginRight' : 'marginLeft'; const i = this._getCanCellFit(); this.cells.forEach(function (n, o) {
        if (t.cells.length) {
          const s = t.outerWidth - t.firstMargin + (n.size.outerWidth - n.size[e]); i.call(this, o, s) || (t.updateTarget(), t = new r(this), this.slides.push(t)), t.addCell(n);
        } else {
          t.addCell(n);
        }
      }, this), t.updateTarget(), this.updateSelectedSlide();
    }
  }, d._getCanCellFit = function () {
    const t = this.options.groupCells; if (!t) {
      return function () {
        return !1;
      };
    } if (typeof t == 'number') {
      const e = Number.parseInt(t, 10); return function (t) {
        return t % e != 0;
      };
    } const i = typeof t == 'string' && t.match(/^(\d+)%$/); const n = i ? Number.parseInt(i[1], 10) / 100 : 1; return function (t, e) {
      return e <= (this.size.innerWidth + 1) * n;
    };
  }, d.reposition = function () {
    this.positionCells(), this.positionSliderAtSelected();
  }, d.getSize = function () {
    this.size = i(this.element), this.setCellAlign(), this.cursorPosition = this.size.innerWidth * this.cellAlign;
  }; const h = { center: { left: 0.5, right: 0.5 }, left: { left: 0, right: 1 }, right: { right: 0, left: 1 } }; return d.setCellAlign = function () {
    const t = h[this.options.cellAlign]; this.cellAlign = t ? t[this.originSide] : this.options.cellAlign;
  }, d.setGallerySize = function () {
    if (this.options.setGallerySize) {
      const t = this.options.adaptiveHeight && this.selectedSlide ? this.selectedSlide.height : this.maxCellHeight; this.viewport.style.height = `${t}px`;
    }
  }, d._getWrapShiftCells = function () {
    if (this.options.wrapAround) {
      this._unshiftCells(this.beforeShiftCells), this._unshiftCells(this.afterShiftCells); let t = this.cursorPosition; const e = this.cells.length - 1; this.beforeShiftCells = this._getGapCells(t, e, -1), t = this.size.innerWidth - this.cursorPosition, this.afterShiftCells = this._getGapCells(t, 0, 1);
    }
  }, d._getGapCells = function (t, e, i) {
    for (var n = []; t > 0;) {
      const o = this.cells[e]; if (!o) {
        break;
      } n.push(o), e += i, t -= o.size.outerWidth;
    } return n;
  }, d._containSlides = function () {
    if (this.options.contain && !this.options.wrapAround && this.cells.length) {
      const t = this.options.rightToLeft; const e = t ? 'marginRight' : 'marginLeft'; const i = t ? 'marginLeft' : 'marginRight'; const n = this.slideableWidth - this.getLastCell().size[i]; const o = n < this.size.innerWidth; const r = this.cursorPosition + this.cells[0].size[e]; const s = n - this.size.innerWidth * (1 - this.cellAlign); this.slides.forEach(function (t) {
        o ? t.target = n * this.cellAlign : (t.target = Math.max(t.target, r), t.target = Math.min(t.target, s));
      }, this);
    }
  }, d.dispatchEvent = function (t, e, i) {
    const n = e ? [e].concat(i) : i; this.emitEvent(t, n);
  }, d.select = function (t, e, i) {
    if (this.isActive && (t = Number.parseInt(t, 10), this._wrapSelect(t), (this.options.wrapAround || e) && (t = n.modulo(t, this.slides.length)), this.slides[t])) {
      const o = this.selectedIndex; this.selectedIndex = t, this.updateSelectedSlide(), i ? this.positionSliderAtSelected() : this.startAnimation(), this.options.adaptiveHeight && this.setGallerySize(), this.dispatchEvent('select', null, [t]), t != o && this.dispatchEvent('change', null, [t]), this.dispatchEvent('cellSelect');
    }
  }, d._wrapSelect = function (t) {
    const e = this.slides.length; if (!(this.options.wrapAround && e > 1)) {
      return t;
    } const i = n.modulo(t, e); const o = Math.abs(i - this.selectedIndex); const r = Math.abs(i + e - this.selectedIndex); const s = Math.abs(i - e - this.selectedIndex); !this.isDragSelect && r < o ? t += e : !this.isDragSelect && s < o && (t -= e), t < 0 ? this.x -= this.slideableWidth : t >= e && (this.x += this.slideableWidth);
  }, d.previous = function (t, e) {
    this.select(this.selectedIndex - 1, t, e);
  }, d.next = function (t, e) {
    this.select(this.selectedIndex + 1, t, e);
  }, d.updateSelectedSlide = function () {
    const t = this.slides[this.selectedIndex]; t && (this.unselectSelectedSlide(), this.selectedSlide = t, t.select(), this.selectedCells = t.cells, this.selectedElements = t.getCellElements(), this.selectedCell = t.cells[0], this.selectedElement = this.selectedElements[0]);
  }, d.unselectSelectedSlide = function () {
    this.selectedSlide && this.selectedSlide.unselect();
  }, d.selectInitialIndex = function () {
    const t = this.options.initialIndex; if (this.isInitActivated) {
      this.select(this.selectedIndex, !1, !0);
    } else {
      if (t && typeof t == 'string') {
        if (this.queryCell(t)) {
          return void this.selectCell(t, !1, !0);
        }
      } let e = 0; t && this.slides[t] && (e = t), this.select(e, !1, !0);
    }
  }, d.selectCell = function (t, e, i) {
    const n = this.queryCell(t); if (n) {
      const o = this.getCellSlideIndex(n); this.select(o, e, i);
    }
  }, d.getCellSlideIndex = function (t) {
    for (let e = 0; e < this.slides.length; e++) {
      if (this.slides[e].cells.includes(t)) {
        return e;
      }
    }
  }, d.getCell = function (t) {
    for (let e = 0; e < this.cells.length; e++) {
      const i = this.cells[e]; if (i.element == t) {
        return i;
      }
    }
  }, d.getCells = function (t) {
    t = n.makeArray(t); const e = []; return t.forEach(function (t) {
      const i = this.getCell(t); i && e.push(i);
    }, this), e;
  }, d.getCellElements = function () {
    return this.cells.map((t) => {
      return t.element;
    });
  }, d.getParentCell = function (t) {
    const e = this.getCell(t); return e || (t = n.getParent(t, '.flickity-slider > *'), this.getCell(t));
  }, d.getAdjacentCellElements = function (t, e) {
    if (!t) {
      return this.selectedSlide.getCellElements();
    } e = void 0 === e ? this.selectedIndex : e; const i = this.slides.length; if (1 + 2 * t >= i) {
      return this.getCellElements();
    } for (var o = [], r = e - t; r <= e + t; r++) {
      const s = this.options.wrapAround ? n.modulo(r, i) : r; const a = this.slides[s]; a && (o = o.concat(a.getCellElements()));
    } return o;
  }, d.queryCell = function (t) {
    if (typeof t == 'number') {
      return this.cells[t];
    } if (typeof t == 'string') {
      if (t.match(/^[#.]?[\d/]/)) {
        return;
      } t = this.element.querySelector(t);
    } return this.getCell(t);
  }, d.uiChange = function () {
    this.emitEvent('uiChange');
  }, d.childUIPointerDown = function (t) {
    t.type != 'touchstart' && t.preventDefault(), this.focus();
  }, d.onresize = function () {
    this.resize();
  }, n.debounceMethod(u, 'onresize', 150), d.resize = function () {
    if (this.isActive) {
      this.getSize(), this.options.wrapAround && (this.x = n.modulo(this.x, this.slideableWidth)), this.positionCells(), this._getWrapShiftCells(), this.setGallerySize(), this.emitEvent('resize'); const t = this.selectedElements && this.selectedElements[0]; this.selectCell(t, !1, !0);
    }
  }, d.onkeydown = function (t) {
    const e = document.activeElement && document.activeElement != this.element; if (this.options.accessibility && !e) {
      const i = u.keyboardHandlers[t.keyCode]; i && i.call(this);
    }
  }, u.keyboardHandlers = { 37() {
    const t = this.options.rightToLeft ? 'next' : 'previous'; this.uiChange(), this[t]();
  }, 39() {
    const t = this.options.rightToLeft ? 'previous' : 'next'; this.uiChange(), this[t]();
  } }, d.focus = function () {
    const e = t.pageYOffset; this.element.focus({ preventScroll: !0 }), t.pageYOffset != e && t.scrollTo(t.pageXOffset, e);
  }, d.deactivate = function () {
    this.isActive && (this.element.classList.remove('flickity-enabled'), this.element.classList.remove('flickity-rtl'), this.unselectSelectedSlide(), this.cells.forEach((t) => {
      t.destroy();
    }), this.element.removeChild(this.viewport), a(this.slider.children, this.element), this.options.accessibility && (this.element.removeAttribute('tabIndex'), this.element.removeEventListener('keydown', this)), this.isActive = !1, this.emitEvent('deactivate'));
  }, d.destroy = function () {
    this.deactivate(), t.removeEventListener('resize', this), this.allOff(), this.emitEvent('destroy'), delete this.element.flickityGUID, delete c[this.guid];
  }, n.extend(d, s), u.data = function (t) {
    const e = (t = n.getQueryElement(t)) && t.flickityGUID; return e && c[e];
  }, n.htmlInit(u, 'flickity'), u.Cell = o, u.Slide = r, u;
})),
/*!
 * Unipointer v2.3.0
 * base class for doing one thing with pointer event
 * MIT license
 */
(function (t, e) {
  typeof define == 'function' && define.amd
    ? define('unipointer/unipointer', ['ev-emitter/ev-emitter'], (i) => {
      return e(t, i);
    })
    : typeof module == 'object' && module.exports ? module.exports = e(t, require('ev-emitter')) : t.Unipointer = e(t, t.EvEmitter);
}(window, (t, e) => {
  function i() {} const n = i.prototype = Object.create(e.prototype); n.bindStartEvent = function (t) {
    this._bindStartEvent(t, !0);
  }, n.unbindStartEvent = function (t) {
    this._bindStartEvent(t, !1);
  }, n._bindStartEvent = function (e, i) {
    const n = (i = void 0 === i || i) ? 'addEventListener' : 'removeEventListener'; let o = 'mousedown'; t.PointerEvent ? o = 'pointerdown' : 'ontouchstart' in t && (o = 'touchstart'), e[n](o, this);
  }, n.handleEvent = function (t) {
    const e = `on${t.type}`; this[e] && this[e](t);
  }, n.getTouch = function (t) {
    for (let e = 0; e < t.length; e++) {
      const i = t[e]; if (i.identifier == this.pointerIdentifier) {
        return i;
      }
    }
  }, n.onmousedown = function (t) {
    const e = t.button; e && e !== 0 && e !== 1 || this._pointerDown(t, t);
  }, n.ontouchstart = function (t) {
    this._pointerDown(t, t.changedTouches[0]);
  }, n.onpointerdown = function (t) {
    this._pointerDown(t, t);
  }, n._pointerDown = function (t, e) {
    t.button || this.isPointerDown || (this.isPointerDown = !0, this.pointerIdentifier = void 0 !== e.pointerId ? e.pointerId : e.identifier, this.pointerDown(t, e));
  }, n.pointerDown = function (t, e) {
    this._bindPostStartEvents(t), this.emitEvent('pointerDown', [t, e]);
  }; const o = { mousedown: ['mousemove', 'mouseup'], touchstart: ['touchmove', 'touchend', 'touchcancel'], pointerdown: ['pointermove', 'pointerup', 'pointercancel'] }; return n._bindPostStartEvents = function (e) {
    if (e) {
      const i = o[e.type]; i.forEach(function (e) {
        t.addEventListener(e, this);
      }, this), this._boundPointerEvents = i;
    }
  }, n._unbindPostStartEvents = function () {
    this._boundPointerEvents && (this._boundPointerEvents.forEach(function (e) {
      t.removeEventListener(e, this);
    }, this), delete this._boundPointerEvents);
  }, n.onmousemove = function (t) {
    this._pointerMove(t, t);
  }, n.onpointermove = function (t) {
    t.pointerId == this.pointerIdentifier && this._pointerMove(t, t);
  }, n.ontouchmove = function (t) {
    const e = this.getTouch(t.changedTouches); e && this._pointerMove(t, e);
  }, n._pointerMove = function (t, e) {
    this.pointerMove(t, e);
  }, n.pointerMove = function (t, e) {
    this.emitEvent('pointerMove', [t, e]);
  }, n.onmouseup = function (t) {
    this._pointerUp(t, t);
  }, n.onpointerup = function (t) {
    t.pointerId == this.pointerIdentifier && this._pointerUp(t, t);
  }, n.ontouchend = function (t) {
    const e = this.getTouch(t.changedTouches); e && this._pointerUp(t, e);
  }, n._pointerUp = function (t, e) {
    this._pointerDone(), this.pointerUp(t, e);
  }, n.pointerUp = function (t, e) {
    this.emitEvent('pointerUp', [t, e]);
  }, n._pointerDone = function () {
    this._pointerReset(), this._unbindPostStartEvents(), this.pointerDone();
  }, n._pointerReset = function () {
    this.isPointerDown = !1, delete this.pointerIdentifier;
  }, n.pointerDone = function () {}, n.onpointercancel = function (t) {
    t.pointerId == this.pointerIdentifier && this._pointerCancel(t, t);
  }, n.ontouchcancel = function (t) {
    const e = this.getTouch(t.changedTouches); e && this._pointerCancel(t, e);
  }, n._pointerCancel = function (t, e) {
    this._pointerDone(), this.pointerCancel(t, e);
  }, n.pointerCancel = function (t, e) {
    this.emitEvent('pointerCancel', [t, e]);
  }, i.getPointerPoint = function (t) {
    return { x: t.pageX, y: t.pageY };
  }, i;
})),
/*!
 * Unidragger v2.3.1
 * Draggable base class
 * MIT license
 */
(function (t, e) {
  typeof define == 'function' && define.amd
    ? define('unidragger/unidragger', ['unipointer/unipointer'], (i) => {
      return e(t, i);
    })
    : typeof module == 'object' && module.exports ? module.exports = e(t, require('unipointer')) : t.Unidragger = e(t, t.Unipointer);
}(window, (t, e) => {
  function i() {} const n = i.prototype = Object.create(e.prototype); n.bindHandles = function () {
    this._bindHandles(!0);
  }, n.unbindHandles = function () {
    this._bindHandles(!1);
  }, n._bindHandles = function (e) {
    for (let i = (e = void 0 === e || e) ? 'addEventListener' : 'removeEventListener', n = e ? this._touchActionValue : '', o = 0; o < this.handles.length; o++) {
      const r = this.handles[o]; this._bindStartEvent(r, e), r[i]('click', this), t.PointerEvent && (r.style.touchAction = n);
    }
  }, n._touchActionValue = 'none', n.pointerDown = function (t, e) {
    this.okayPointerDown(t) && (this.pointerDownPointer = { pageX: e.pageX, pageY: e.pageY }, t.preventDefault(), this.pointerDownBlur(), this._bindPostStartEvents(t), this.emitEvent('pointerDown', [t, e]));
  }; const o = { TEXTAREA: !0, INPUT: !0, SELECT: !0, OPTION: !0 }; const r = { radio: !0, checkbox: !0, button: !0, submit: !0, image: !0, file: !0 }; return n.okayPointerDown = function (t) {
    const e = o[t.target.nodeName]; const i = r[t.target.type]; const n = !e || i; return n || this._pointerReset(), n;
  }, n.pointerDownBlur = function () {
    const t = document.activeElement; t && t.blur && t != document.body && t.blur();
  }, n.pointerMove = function (t, e) {
    const i = this._dragPointerMove(t, e); this.emitEvent('pointerMove', [t, e, i]), this._dragMove(t, e, i);
  }, n._dragPointerMove = function (t, e) {
    const i = { x: e.pageX - this.pointerDownPointer.pageX, y: e.pageY - this.pointerDownPointer.pageY }; return !this.isDragging && this.hasDragStarted(i) && this._dragStart(t, e), i;
  }, n.hasDragStarted = function (t) {
    return Math.abs(t.x) > 3 || Math.abs(t.y) > 3;
  }, n.pointerUp = function (t, e) {
    this.emitEvent('pointerUp', [t, e]), this._dragPointerUp(t, e);
  }, n._dragPointerUp = function (t, e) {
    this.isDragging ? this._dragEnd(t, e) : this._staticClick(t, e);
  }, n._dragStart = function (t, e) {
    this.isDragging = !0, this.isPreventingClicks = !0, this.dragStart(t, e);
  }, n.dragStart = function (t, e) {
    this.emitEvent('dragStart', [t, e]);
  }, n._dragMove = function (t, e, i) {
    this.isDragging && this.dragMove(t, e, i);
  }, n.dragMove = function (t, e, i) {
    t.preventDefault(), this.emitEvent('dragMove', [t, e, i]);
  }, n._dragEnd = function (t, e) {
    this.isDragging = !1, setTimeout(() => {
      delete this.isPreventingClicks;
    }), this.dragEnd(t, e);
  }, n.dragEnd = function (t, e) {
    this.emitEvent('dragEnd', [t, e]);
  }, n.onclick = function (t) {
    this.isPreventingClicks && t.preventDefault();
  }, n._staticClick = function (t, e) {
    this.isIgnoringMouseUp && t.type == 'mouseup' || (this.staticClick(t, e), t.type != 'mouseup' && (this.isIgnoringMouseUp = !0, setTimeout(() => {
      delete this.isIgnoringMouseUp;
    }, 400)));
  }, n.staticClick = function (t, e) {
    this.emitEvent('staticClick', [t, e]);
  }, i.getPointerPoint = e.getPointerPoint, i;
})), (function (t, e) {
  typeof define == 'function' && define.amd
    ? define('flickity/js/drag', ['./flickity', 'unidragger/unidragger', 'fizzy-ui-utils/utils'], (i, n, o) => {
      return e(t, i, n, o);
    })
    : typeof module == 'object' && module.exports ? module.exports = e(t, require('./flickity'), require('unidragger'), require('fizzy-ui-utils')) : t.Flickity = e(t, t.Flickity, t.Unidragger, t.fizzyUIUtils);
}(window, (t, e, i, n) => {
  n.extend(e.defaults, { draggable: '>1', dragThreshold: 3 }), e.createMethods.push('_createDrag'); const o = e.prototype; n.extend(o, i.prototype), o._touchActionValue = 'pan-y'; const r = 'createTouch' in document; let s = !1; o._createDrag = function () {
    this.on('activate', this.onActivateDrag), this.on('uiChange', this._uiChangeDrag), this.on('deactivate', this.onDeactivateDrag), this.on('cellChange', this.updateDraggable), r && !s && (t.addEventListener('touchmove', () => {}), s = !0);
  }, o.onActivateDrag = function () {
    this.handles = [this.viewport], this.bindHandles(), this.updateDraggable();
  }, o.onDeactivateDrag = function () {
    this.unbindHandles(), this.element.classList.remove('is-draggable');
  }, o.updateDraggable = function () {
    this.options.draggable == '>1' ? this.isDraggable = this.slides.length > 1 : this.isDraggable = this.options.draggable, this.isDraggable ? this.element.classList.add('is-draggable') : this.element.classList.remove('is-draggable');
  }, o.bindDrag = function () {
    this.options.draggable = !0, this.updateDraggable();
  }, o.unbindDrag = function () {
    this.options.draggable = !1, this.updateDraggable();
  }, o._uiChangeDrag = function () {
    delete this.isFreeScrolling;
  }, o.pointerDown = function (e, i) {
    this.isDraggable ? this.okayPointerDown(e) && (this._pointerDownPreventDefault(e), this.pointerDownFocus(e), document.activeElement != this.element && this.pointerDownBlur(), this.dragX = this.x, this.viewport.classList.add('is-pointer-down'), this.pointerDownScroll = l(), t.addEventListener('scroll', this), this._pointerDownDefault(e, i)) : this._pointerDownDefault(e, i);
  }, o._pointerDownDefault = function (t, e) {
    this.pointerDownPointer = { pageX: e.pageX, pageY: e.pageY }, this._bindPostStartEvents(t), this.dispatchEvent('pointerDown', t, [e]);
  }; const a = { INPUT: !0, TEXTAREA: !0, SELECT: !0 }; function l() {
    return { x: t.pageXOffset, y: t.pageYOffset };
  } return o.pointerDownFocus = function (t) {
    a[t.target.nodeName] || this.focus();
  }, o._pointerDownPreventDefault = function (t) {
    const e = t.type == 'touchstart'; const i = t.pointerType == 'touch'; const n = a[t.target.nodeName]; e || i || n || t.preventDefault();
  }, o.hasDragStarted = function (t) {
    return Math.abs(t.x) > this.options.dragThreshold;
  }, o.pointerUp = function (t, e) {
    delete this.isTouchScrolling, this.viewport.classList.remove('is-pointer-down'), this.dispatchEvent('pointerUp', t, [e]), this._dragPointerUp(t, e);
  }, o.pointerDone = function () {
    t.removeEventListener('scroll', this), delete this.pointerDownScroll;
  }, o.dragStart = function (e, i) {
    this.isDraggable && (this.dragStartPosition = this.x, this.startAnimation(), t.removeEventListener('scroll', this), this.dispatchEvent('dragStart', e, [i]));
  }, o.pointerMove = function (t, e) {
    const i = this._dragPointerMove(t, e); this.dispatchEvent('pointerMove', t, [e, i]), this._dragMove(t, e, i);
  }, o.dragMove = function (t, e, i) {
    if (this.isDraggable) {
      t.preventDefault(), this.previousDragX = this.dragX; const n = this.options.rightToLeft ? -1 : 1; this.options.wrapAround && (i.x %= this.slideableWidth); let o = this.dragStartPosition + i.x * n; if (!this.options.wrapAround && this.slides.length) {
        const r = Math.max(-this.slides[0].target, this.dragStartPosition); o = o > r ? 0.5 * (o + r) : o; const s = Math.min(-this.getLastSlide().target, this.dragStartPosition); o = o < s ? 0.5 * (o + s) : o;
      } this.dragX = o, this.dragMoveTime = new Date(), this.dispatchEvent('dragMove', t, [e, i]);
    }
  }, o.dragEnd = function (t, e) {
    if (this.isDraggable) {
      this.options.freeScroll && (this.isFreeScrolling = !0); let i = this.dragEndRestingSelect(); if (this.options.freeScroll && !this.options.wrapAround) {
        const n = this.getRestingPosition(); this.isFreeScrolling = -n > this.slides[0].target && -n < this.getLastSlide().target;
      } else {
        this.options.freeScroll || i != this.selectedIndex || (i += this.dragEndBoostSelect());
      } delete this.previousDragX, this.isDragSelect = this.options.wrapAround, this.select(i), delete this.isDragSelect, this.dispatchEvent('dragEnd', t, [e]);
    }
  }, o.dragEndRestingSelect = function () {
    const t = this.getRestingPosition(); const e = Math.abs(this.getSlideDistance(-t, this.selectedIndex)); const i = this._getClosestResting(t, e, 1); const n = this._getClosestResting(t, e, -1); return i.distance < n.distance ? i.index : n.index;
  }, o._getClosestResting = function (t, e, i) {
    for (var n = this.selectedIndex, o = 1 / 0, r = this.options.contain && !this.options.wrapAround
      ? function (t, e) {
        return t <= e;
      }
      : function (t, e) {
        return t < e;
      }; r(e, o) && (n += i, o = e, (e = this.getSlideDistance(-t, n)) !== null);) {
      e = Math.abs(e);
    } return { distance: o, index: n - i };
  }, o.getSlideDistance = function (t, e) {
    const i = this.slides.length; const o = this.options.wrapAround && i > 1; const r = o ? n.modulo(e, i) : e; const s = this.slides[r]; if (!s) {
      return null;
    } const a = o ? this.slideableWidth * Math.floor(e / i) : 0; return t - (s.target + a);
  }, o.dragEndBoostSelect = function () {
    if (void 0 === this.previousDragX || !this.dragMoveTime || new Date() - this.dragMoveTime > 100) {
      return 0;
    } const t = this.getSlideDistance(-this.dragX, this.selectedIndex); const e = this.previousDragX - this.dragX; return t > 0 && e > 0 ? 1 : t < 0 && e < 0 ? -1 : 0;
  }, o.staticClick = function (t, e) {
    const i = this.getParentCell(t.target); const n = i && i.element; const o = i && this.cells.indexOf(i); this.dispatchEvent('staticClick', t, [e, n, o]);
  }, o.onscroll = function () {
    const t = l(); const e = this.pointerDownScroll.x - t.x; const i = this.pointerDownScroll.y - t.y; (Math.abs(e) > 3 || Math.abs(i) > 3) && this._pointerDone();
  }, e;
})), (function (t, e) {
  typeof define == 'function' && define.amd
    ? define('flickity/js/prev-next-button', ['./flickity', 'unipointer/unipointer', 'fizzy-ui-utils/utils'], (i, n, o) => {
      return e(t, i, n, o);
    })
    : typeof module == 'object' && module.exports ? module.exports = e(t, require('./flickity'), require('unipointer'), require('fizzy-ui-utils')) : e(t, t.Flickity, t.Unipointer, t.fizzyUIUtils);
}(window, (t, e, i, n) => {
  'use strict'; const o = 'http://www.w3.org/2000/svg'; function r(t, e) {
    this.direction = t, this.parent = e, this._create();
  }r.prototype = Object.create(i.prototype), r.prototype._create = function () {
    this.isEnabled = !0, this.isPrevious = this.direction == -1; const t = this.parent.options.rightToLeft ? 1 : -1; this.isLeft = this.direction == t; const e = this.element = document.createElement('button'); e.className = 'flickity-button flickity-prev-next-button', e.className += this.isPrevious ? ' flickity-previous' : ' flickity-next', e.setAttribute('type', 'button'), this.disable(), e.setAttribute('aria-label', this.isPrevious ? 'Previous' : 'Next'); const i = this.createSVG(); e.appendChild(i), this.parent.on('select', this.update.bind(this)), this.on('pointerDown', this.parent.childUIPointerDown.bind(this.parent));
  }, r.prototype.activate = function () {
    this.bindStartEvent(this.element), this.element.addEventListener('click', this), this.parent.element.appendChild(this.element);
  }, r.prototype.deactivate = function () {
    this.parent.element.removeChild(this.element), this.unbindStartEvent(this.element), this.element.removeEventListener('click', this);
  }, r.prototype.createSVG = function () {
    const t = document.createElementNS(o, 'svg'); t.setAttribute('class', 'flickity-button-icon'), t.setAttribute('viewBox', '0 0 100 100'); const e = document.createElementNS(o, 'path'); const i = (function (t) {
      if (typeof t == 'string') {
        return t;
      } return `M ${t.x0},50 L ${t.x1},${t.y1 + 50} L ${t.x2},${t.y2 + 50} L ${t.x3},50  L ${t.x2},${50 - t.y2} L ${t.x1},${50 - t.y1} Z`;
    }(this.parent.options.arrowShape)); return e.setAttribute('d', i), e.setAttribute('class', 'arrow'), this.isLeft || e.setAttribute('transform', 'translate(100, 100) rotate(180) '), t.appendChild(e), t;
  }, r.prototype.handleEvent = n.handleEvent, r.prototype.onclick = function () {
    if (this.isEnabled) {
      this.parent.uiChange(); const t = this.isPrevious ? 'previous' : 'next'; this.parent[t]();
    }
  }, r.prototype.enable = function () {
    this.isEnabled || (this.element.disabled = !1, this.isEnabled = !0);
  }, r.prototype.disable = function () {
    this.isEnabled && (this.element.disabled = !0, this.isEnabled = !1);
  }, r.prototype.update = function () {
    const t = this.parent.slides; if (this.parent.options.wrapAround && t.length > 1) {
      this.enable();
    } else {
      const e = t.length ? t.length - 1 : 0; const i = this.isPrevious ? 0 : e; this[this.parent.selectedIndex == i ? 'disable' : 'enable']();
    }
  }, r.prototype.destroy = function () {
    this.deactivate(), this.allOff();
  }, n.extend(e.defaults, { prevNextButtons: !0, arrowShape: { x0: 10, x1: 60, y1: 50, x2: 70, y2: 40, x3: 30 } }), e.createMethods.push('_createPrevNextButtons'); const s = e.prototype; return s._createPrevNextButtons = function () {
    this.options.prevNextButtons && (this.prevButton = new r(-1, this), this.nextButton = new r(1, this), this.on('activate', this.activatePrevNextButtons));
  }, s.activatePrevNextButtons = function () {
    this.prevButton.activate(), this.nextButton.activate(), this.on('deactivate', this.deactivatePrevNextButtons);
  }, s.deactivatePrevNextButtons = function () {
    this.prevButton.deactivate(), this.nextButton.deactivate(), this.off('deactivate', this.deactivatePrevNextButtons);
  }, e.PrevNextButton = r, e;
})), (function (t, e) {
  typeof define == 'function' && define.amd
    ? define('flickity/js/page-dots', ['./flickity', 'unipointer/unipointer', 'fizzy-ui-utils/utils'], (i, n, o) => {
      return e(t, i, n, o);
    })
    : typeof module == 'object' && module.exports ? module.exports = e(t, require('./flickity'), require('unipointer'), require('fizzy-ui-utils')) : e(t, t.Flickity, t.Unipointer, t.fizzyUIUtils);
}(window, (t, e, i, n) => {
  function o(t) {
    this.parent = t, this._create();
  }o.prototype = Object.create(i.prototype), o.prototype._create = function () {
    this.holder = document.createElement('ol'), this.holder.className = 'flickity-page-dots', this.dots = [], this.handleClick = this.onClick.bind(this), this.on('pointerDown', this.parent.childUIPointerDown.bind(this.parent));
  }, o.prototype.activate = function () {
    this.setDots(), this.holder.addEventListener('click', this.handleClick), this.bindStartEvent(this.holder), this.parent.element.appendChild(this.holder);
  }, o.prototype.deactivate = function () {
    this.holder.removeEventListener('click', this.handleClick), this.unbindStartEvent(this.holder), this.parent.element.removeChild(this.holder);
  }, o.prototype.setDots = function () {
    const t = this.parent.slides.length - this.dots.length; t > 0 ? this.addDots(t) : t < 0 && this.removeDots(-t);
  }, o.prototype.addDots = function (t) {
    for (var e = document.createDocumentFragment(), i = [], n = this.dots.length, o = n + t, r = n; r < o; r++) {
      const s = document.createElement('li'); s.className = 'dot', s.setAttribute('aria-label', `Page dot ${r + 1}`), e.appendChild(s), i.push(s);
    } this.holder.appendChild(e), this.dots = this.dots.concat(i);
  }, o.prototype.removeDots = function (t) {
    this.dots.splice(this.dots.length - t, t).forEach(function (t) {
      this.holder.removeChild(t);
    }, this);
  }, o.prototype.updateSelected = function () {
    this.selectedDot && (this.selectedDot.className = 'dot', this.selectedDot.removeAttribute('aria-current')), this.dots.length && (this.selectedDot = this.dots[this.parent.selectedIndex], this.selectedDot.className = 'dot is-selected', this.selectedDot.setAttribute('aria-current', 'step'));
  }, o.prototype.onTap = o.prototype.onClick = function (t) {
    const e = t.target; if (e.nodeName == 'LI') {
      this.parent.uiChange(); const i = this.dots.indexOf(e); this.parent.select(i);
    }
  }, o.prototype.destroy = function () {
    this.deactivate(), this.allOff();
  }, e.PageDots = o, n.extend(e.defaults, { pageDots: !0 }), e.createMethods.push('_createPageDots'); const r = e.prototype; return r._createPageDots = function () {
    this.options.pageDots && (this.pageDots = new o(this), this.on('activate', this.activatePageDots), this.on('select', this.updateSelectedPageDots), this.on('cellChange', this.updatePageDots), this.on('resize', this.updatePageDots), this.on('deactivate', this.deactivatePageDots));
  }, r.activatePageDots = function () {
    this.pageDots.activate();
  }, r.updateSelectedPageDots = function () {
    this.pageDots.updateSelected();
  }, r.updatePageDots = function () {
    this.pageDots.setDots();
  }, r.deactivatePageDots = function () {
    this.pageDots.deactivate();
  }, e.PageDots = o, e;
})), (function (t, e) {
  typeof define == 'function' && define.amd
    ? define('flickity/js/player', ['ev-emitter/ev-emitter', 'fizzy-ui-utils/utils', './flickity'], (t, i, n) => {
      return e(t, i, n);
    })
    : typeof module == 'object' && module.exports ? module.exports = e(require('ev-emitter'), require('fizzy-ui-utils'), require('./flickity')) : e(t.EvEmitter, t.fizzyUIUtils, t.Flickity);
}(window, (t, e, i) => {
  function n(t) {
    this.parent = t, this.state = 'stopped', this.onVisibilityChange = this.visibilityChange.bind(this), this.onVisibilityPlay = this.visibilityPlay.bind(this);
  }n.prototype = Object.create(t.prototype), n.prototype.play = function () {
    this.state != 'playing' && (document.hidden ? document.addEventListener('visibilitychange', this.onVisibilityPlay) : (this.state = 'playing', document.addEventListener('visibilitychange', this.onVisibilityChange), this.tick()));
  }, n.prototype.tick = function () {
    if (this.state == 'playing') {
      let t = this.parent.options.autoPlay; t = typeof t == 'number' ? t : 3e3; const e = this; this.clear(), this.timeout = setTimeout(() => {
        e.parent.next(!0), e.tick();
      }, t);
    }
  }, n.prototype.stop = function () {
    this.state = 'stopped', this.clear(), document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }, n.prototype.clear = function () {
    clearTimeout(this.timeout);
  }, n.prototype.pause = function () {
    this.state == 'playing' && (this.state = 'paused', this.clear());
  }, n.prototype.unpause = function () {
    this.state == 'paused' && this.play();
  }, n.prototype.visibilityChange = function () {
    this[document.hidden ? 'pause' : 'unpause']();
  }, n.prototype.visibilityPlay = function () {
    this.play(), document.removeEventListener('visibilitychange', this.onVisibilityPlay);
  }, e.extend(i.defaults, { pauseAutoPlayOnHover: !0 }), i.createMethods.push('_createPlayer'); const o = i.prototype; return o._createPlayer = function () {
    this.player = new n(this), this.on('activate', this.activatePlayer), this.on('uiChange', this.stopPlayer), this.on('pointerDown', this.stopPlayer), this.on('deactivate', this.deactivatePlayer);
  }, o.activatePlayer = function () {
    this.options.autoPlay && (this.player.play(), this.element.addEventListener('mouseenter', this));
  }, o.playPlayer = function () {
    this.player.play();
  }, o.stopPlayer = function () {
    this.player.stop();
  }, o.pausePlayer = function () {
    this.player.pause();
  }, o.unpausePlayer = function () {
    this.player.unpause();
  }, o.deactivatePlayer = function () {
    this.player.stop(), this.element.removeEventListener('mouseenter', this);
  }, o.onmouseenter = function () {
    this.options.pauseAutoPlayOnHover && (this.player.pause(), this.element.addEventListener('mouseleave', this));
  }, o.onmouseleave = function () {
    this.player.unpause(), this.element.removeEventListener('mouseleave', this);
  }, i.Player = n, i;
})), (function (t, e) {
  typeof define == 'function' && define.amd
    ? define('flickity/js/add-remove-cell', ['./flickity', 'fizzy-ui-utils/utils'], (i, n) => {
      return e(t, i, n);
    })
    : typeof module == 'object' && module.exports ? module.exports = e(t, require('./flickity'), require('fizzy-ui-utils')) : e(t, t.Flickity, t.fizzyUIUtils);
}(window, (t, e, i) => {
  const n = e.prototype; return n.insert = function (t, e) {
    const i = this._makeCells(t); if (i && i.length) {
      const n = this.cells.length; e = void 0 === e ? n : e; const o = (function (t) {
        const e = document.createDocumentFragment(); return t.forEach((t) => {
          e.appendChild(t.element);
        }), e;
      }(i)); const r = e == n; if (r) {
        this.slider.appendChild(o);
      } else {
        const s = this.cells[e].element; this.slider.insertBefore(o, s);
      } if (e === 0) {
        this.cells = i.concat(this.cells);
      } else if (r) {
        this.cells = this.cells.concat(i);
      } else {
        const a = this.cells.splice(e, n - e); this.cells = this.cells.concat(i).concat(a);
      } this._sizeCells(i), this.cellChange(e, !0);
    }
  }, n.append = function (t) {
    this.insert(t, this.cells.length);
  }, n.prepend = function (t) {
    this.insert(t, 0);
  }, n.remove = function (t) {
    const e = this.getCells(t); if (e && e.length) {
      let n = this.cells.length - 1; e.forEach(function (t) {
        t.remove(); const e = this.cells.indexOf(t); n = Math.min(e, n), i.removeFrom(this.cells, t);
      }, this), this.cellChange(n, !0);
    }
  }, n.cellSizeChange = function (t) {
    const e = this.getCell(t); if (e) {
      e.getSize(); const i = this.cells.indexOf(e); this.cellChange(i);
    }
  }, n.cellChange = function (t, e) {
    const i = this.selectedElement; this._positionCells(t), this._getWrapShiftCells(), this.setGallerySize(); const n = this.getCell(i); n && (this.selectedIndex = this.getCellSlideIndex(n)), this.selectedIndex = Math.min(this.slides.length - 1, this.selectedIndex), this.emitEvent('cellChange', [t]), this.select(this.selectedIndex), e && this.positionSliderAtSelected();
  }, e;
})),
/*!
 * Flickity v2.2.2
 * Touch, responsive, flickable carousels
 *
 * Licensed GPLv3 for open source use
 * or Flickity Commercial License for commercial use
 *
 * https://flickity.metafizzy.co
 * Copyright 2015-2021 Metafizzy
 */
(function (t, e) {
  typeof define == 'function' && define.amd ? define('flickity/js/index', ['./flickity', './drag', './prev-next-button', './page-dots', './player', './add-remove-cell'], e) : typeof module == 'object' && module.exports && (module.exports = e(require('./flickity'), require('./drag'), require('./prev-next-button'), require('./page-dots'), require('./player'), require('./add-remove-cell')));
}(window, (t) => {
  return t;
})), (function (t, e) {
  typeof define == 'function' && define.amd ? define(['flickity/js/index', 'fizzy-ui-utils/utils'], e) : typeof module == 'object' && module.exports ? module.exports = e(require('flickity'), require('fizzy-ui-utils')) : e(t.Flickity, t.fizzyUIUtils);
}(this, (t, e) => {
  const i = t.Slide; const n = i.prototype.updateTarget; i.prototype.updateTarget = function () {
    if (n.apply(this, arguments), this.parent.options.fade) {
      const t = this.target - this.x; const e = this.cells[0].x; this.cells.forEach((i) => {
        const n = i.x - e - t; i.renderPosition(n);
      });
    }
  }; const o = t.prototype; t.createMethods.push('_createFade'), o._createFade = function () {
    this.fadeIndex = this.selectedIndex, this.prevSelectedIndex = this.selectedIndex, this.on('select', this.onSelectFade), this.on('dragEnd', this.onDragEndFade), this.on('settle', this.onSettleFade), this.on('activate', this.onActivateFade), this.on('deactivate', this.onDeactivateFade);
  }; const r = o.updateSlides; o.updateSlides = function () {
    r.apply(this, arguments), this.options.fade;
  }, o.onSelectFade = function () {
    this.fadeIndex = Math.min(this.prevSelectedIndex, this.slides.length - 1), this.prevSelectedIndex = this.selectedIndex;
  }, o.onSettleFade = function () {
    if (delete this.didDragEnd, this.options.fade) {
      this.slides[this.fadeIndex];
    }
  }, o.onDragEndFade = function () {
    this.didDragEnd = !0;
  }, o.onActivateFade = function () {
    this.options.fade && this.element.classList.add('is-fade');
  }, o.onDeactivateFade = function () {
    this.options.fade && this.element.classList.remove('is-fade');
  }; const s = o.positionSlider; o.positionSlider = function () {
    this.options.fade ? (this.fadeSlides(), this.dispatchScrollEvent()) : s.apply(this, arguments);
  }; const a = o.positionSliderAtSelected; o.positionSliderAtSelected = function () {
    this.options.fade && this.setTranslateX(0), a.apply(this, arguments);
  }, o.fadeSlides = function () {
    if (!(this.slides.length < 2)) {
      const t = this.getFadeIndexes(); const e = this.slides[t.a]; const i = this.slides[t.b]; const n = this.wrapDifference(e.target, i.target); let o = this.wrapDifference(e.target, -this.x); o /= n; let r = t.a; this.isDragging && (r = o > 0.5 ? t.a : t.b); this.fadeHideIndex != null && this.fadeHideIndex != r && this.fadeHideIndex != t.a && (this.fadeHideIndex, t.b); this.fadeHideIndex = r;
    }
  }, o.getFadeIndexes = function () {
    return this.isDragging || this.didDragEnd ? this.options.wrapAround ? this.getFadeDragWrapIndexes() : this.getFadeDragLimitIndexes() : { a: this.fadeIndex, b: this.selectedIndex };
  }, o.getFadeDragWrapIndexes = function () {
    const t = this.slides.map(function (t, e) {
      return this.getSlideDistance(-this.x, e);
    }, this); const i = t.map((t) => {
      return Math.abs(t);
    }); const n = Math.min.apply(Math, i); const o = i.indexOf(n); const r = t[o]; const s = this.slides.length; const a = r >= 0 ? 1 : -1; return { a: o, b: e.modulo(o + a, s) };
  }, o.getFadeDragLimitIndexes = function () {
    for (var t = 0, e = 0; e < this.slides.length - 1; e++) {
      const i = this.slides[e]; if (-this.x < i.target) {
        break;
      } t = e;
    } return { a: t, b: t + 1 };
  }, o.wrapDifference = function (t, e) {
    let i = e - t; if (!this.options.wrapAround) {
      return i;
    } const n = i + this.slideableWidth; const o = i - this.slideableWidth; return Math.abs(n) < Math.abs(i) && (i = n), Math.abs(o) < Math.abs(i) && (i = o), i;
  }; const l = o._getWrapShiftCells; o._getWrapShiftCells = function () {
    this.options.fade || l.apply(this, arguments);
  }; const c = o.shiftWrapCells; return o.shiftWrapCells = function () {
    this.options.fade || c.apply(this, arguments);
  }, t;
})),
/*! PhotoSwipe - v4.1.3 - 2019-01-08
* http://photoswipe.com
* Copyright (c) 2019 Dmitry Semenov; */
(function (t, e) {
  typeof define == 'function' && define.amd ? define(e) : typeof exports == 'object' ? module.exports = e() : t.PhotoSwipe = e();
}(this, () => {
  'use strict'; return function (t, e, i, n) {
    var o = { features: null, bind(t, e, i, n) {
      const o = `${n ? 'remove' : 'add'}EventListener`; e = e.split(' '); for (let r = 0; r < e.length; r++) {
        e[r] && t[o](e[r], i, !1);
      }
    }, isArray(t) {
      return Array.isArray(t);
    }, createEl(t, e) {
      const i = document.createElement(e || 'div'); return t && (i.className = t), i;
    }, getScrollY() {
      const t = window.pageYOffset; return void 0 !== t ? t : document.documentElement.scrollTop;
    }, unbind(t, e, i) {
      o.bind(t, e, i, !0);
    }, removeClass(t, e) {
      const i = new RegExp(`(\\s|^)${e}(\\s|$)`); t.className = t.className.replace(i, ' ').replace(/^\s+/, '').replace(/\s+$/, '');
    }, addClass(t, e) {
      o.hasClass(t, e) || (t.className += (t.className ? ' ' : '') + e);
    }, hasClass(t, e) {
      return t.className && new RegExp(`(^|\\s)${e}(\\s|$)`).test(t.className);
    }, getChildByClass(t, e) {
      for (let i = t.firstChild; i;) {
        if (o.hasClass(i, e)) {
          return i;
        } i = i.nextSibling;
      }
    }, arraySearch(t, e, i) {
      for (let n = t.length; n--;) {
        if (t[n][i] === e) {
          return n;
        }
      } return -1;
    }, extend(t, e, i) {
      for (const n in e) {
        if (e.hasOwnProperty(n)) {
          if (i && t.hasOwnProperty(n)) {
            continue;
          } t[n] = e[n];
        }
      }
    }, easing: { sine: { out(t) {
      return Math.sin(t * (Math.PI / 2));
    }, inOut(t) {
      return -(Math.cos(Math.PI * t) - 1) / 2;
    } }, cubic: { out(t) {
      return --t * t * t + 1;
    } } }, detectFeatures() {
      if (o.features) {
        return o.features;
      } const t = o.createEl().style; let e = ''; const i = {}; if (i.oldIE = document.all && !document.addEventListener, i.touch = 'ontouchstart' in window, window.requestAnimationFrame && (i.raf = window.requestAnimationFrame, i.caf = window.cancelAnimationFrame), i.pointerEvent = !!window.PointerEvent || navigator.msPointerEnabled, !i.pointerEvent) {
        const n = navigator.userAgent; if (/iP(hone|od)/.test(navigator.platform)) {
          let r = navigator.appVersion.match(/OS (\d+)_(\d+)_?(\d+)?/); r && r.length > 0 && (r = Number.parseInt(r[1], 10)) >= 1 && r < 8 && (i.isOldIOSPhone = !0);
        } const s = n.match(/Android\s([0-9.]*)/); let a = s ? s[1] : 0; (a = Number.parseFloat(a)) >= 1 && (a < 4.4 && (i.isOldAndroid = !0), i.androidVersion = a), i.isMobileOpera = /opera mini|opera mobi/i.test(n);
      } for (var l, c, u = ['transform', 'perspective', 'animationName'], d = ['', 'webkit', 'Moz', 'ms', 'O'], h = 0; h < 4; h++) {
        e = d[h]; for (let p = 0; p < 3; p++) {
          l = u[p], c = e + (e ? l.charAt(0).toUpperCase() + l.slice(1) : l), !i[l] && c in t && (i[l] = c);
        }e && !i.raf && (e = e.toLowerCase(), i.raf = window[`${e}RequestAnimationFrame`], i.raf && (i.caf = window[`${e}CancelAnimationFrame`] || window[`${e}CancelRequestAnimationFrame`]));
      } if (!i.raf) {
        let f = 0; i.raf = function (t) {
          const e = (new Date()).getTime(); const i = Math.max(0, 16 - (e - f)); const n = window.setTimeout(() => {
            t(e + i);
          }, i); return f = e + i, n;
        }, i.caf = function (t) {
          clearTimeout(t);
        };
      } return i.svg = !!document.createElementNS && !!document.createElementNS('http://www.w3.org/2000/svg', 'svg').createSVGRect, o.features = i, i;
    } }; o.detectFeatures(), o.features.oldIE && (o.bind = function (t, e, i, n) {
      e = e.split(' '); for (var o, r = `${n ? 'detach' : 'attach'}Event`, s = function () {
          i.handleEvent.call(i);
        }, a = 0; a < e.length; a++) {
        if (o = e[a]) {
          if (typeof i == 'object' && i.handleEvent) {
            if (n) {
              if (!i[`oldIE${o}`]) {
                return !1;
              }
            } else {
              i[`oldIE${o}`] = s;
            }t[r](`on${o}`, i[`oldIE${o}`]);
          } else {
            t[r](`on${o}`, i);
          }
        }
      }
    }); const r = this; const s = { allowPanToNext: !0, spacing: 0.12, bgOpacity: 1, mouseUsed: !1, loop: !0, pinchToClose: !0, closeOnScroll: !0, closeOnVerticalDrag: !0, verticalDragRange: 0.75, hideAnimationDuration: 333, showAnimationDuration: 333, showHideOpacity: !1, focus: !0, escKey: !0, arrowKeys: !0, mainScrollEndFriction: 0.35, panEndFriction: 0.35, isClickableElement(t) {
      return t.tagName === 'A';
    }, getDoubleTapZoom(t, e) {
      return t || e.initialZoomLevel < 0.7 ? 1 : 1.33;
    }, maxSpreadZoom: 1.33, modal: !0, scaleMode: 'fit' }; o.extend(s, n); let a; let l; let c; let u; let d; let h; let p; let f; let m; let g; let v; let y; let x; let b; let w; let S; let C; let E; let D; let P; let z; let A; let _; let I; let k; let T; let M; let L; let F; let N; let O; let U; let R; let W; let V; let H; let B; let j; let q; let Z; let X; let G; let Y; let K; let $; let J; let Q; let tt; let et; let it; let nt; let ot; let rt; let st; let at; let lt; const ct = { x: 0, y: 0 }; const ut = { x: 0, y: 0 }; const dt = { x: 0, y: 0 }; const ht = {}; let pt = 0; const ft = {}; const mt = { x: 0, y: 0 }; let gt = 0; let vt = !0; const yt = []; const xt = {}; let bt = !1; const wt = function (t, e) {
      o.extend(r, e.publicMethods), yt.push(t);
    }; const St = function (t) {
      const e = Ve(); return t > e - 1 ? t - e : t < 0 ? e + t : t;
    }; let Ct = {}; const Et = function (t, e) {
      return Ct[t] || (Ct[t] = []), Ct[t].push(e);
    }; const Dt = function (t) {
      const e = Ct[t]; if (e) {
        const i = Array.prototype.slice.call(arguments); i.shift(); for (let n = 0; n < e.length; n++) {
          e[n].apply(r, i);
        }
      }
    }; const Pt = function () {
      return (new Date()).getTime();
    }; const zt = function (t) {
      st = t, r.bg.style.opacity = t * s.bgOpacity;
    }; const At = function (t, e, i, n, o) {
      (!bt || o && o !== r.currItem) && (n /= o ? o.fitRatio : r.currItem.fitRatio), t[A] = `${y + e}px, ${i}px${x} scale(${n})`;
    }; let _t = function (t) {
      et && (t && (g > r.currItem.fitRatio ? bt || (Ke(r.currItem, !1, !0), bt = !0) : bt && (Ke(r.currItem), bt = !1)), At(et, dt.x, dt.y, g));
    }; let It = function (t) {
      t.container && At(t.container.style, t.initialPosition.x, t.initialPosition.y, t.initialZoomLevel, t);
    }; let kt = function (t, e) {
      e[A] = `${y + t}px, 0px${x}`;
    }; const Tt = function (t, e) {
      if (!s.loop && e) {
        const i = u + (mt.x * pt - t) / mt.x; const n = Math.round(t - ue.x); (i < 0 && n > 0 || i >= Ve() - 1 && n < 0) && (t = ue.x + n * s.mainScrollEndFriction);
      }ue.x = t, kt(t, d);
    }; const Mt = function (t, e) {
      const i = de[t] - ft[t]; return ut[t] + ct[t] + i - i * (e / v);
    }; const Lt = function (t, e) {
      t.x = e.x, t.y = e.y, e.id && (t.id = e.id);
    }; const Ft = function (t) {
      t.x = Math.round(t.x), t.y = Math.round(t.y);
    }; let Nt = null; const Ot = function () {
      Nt && (o.unbind(document, 'mousemove', Ot), o.addClass(t, 'pswp--has_mouse'), s.mouseUsed = !0, Dt('mouseUsed')), Nt = setTimeout(() => {
        Nt = null;
      }, 100);
    }; const Ut = function (t, e) {
      const i = Ze(r.currItem, ht, t); return e && (tt = i), i;
    }; const Rt = function (t) {
      return t || (t = r.currItem), t.initialZoomLevel;
    }; const Wt = function (t) {
      return t || (t = r.currItem), t.w > 0 ? s.maxSpreadZoom : 1;
    }; const Vt = function (t, e, i, n) {
      return n === r.currItem.initialZoomLevel ? (i[t] = r.currItem.initialPosition[t], !0) : (i[t] = Mt(t, n), i[t] > e.min[t] ? (i[t] = e.min[t], !0) : i[t] < e.max[t] && (i[t] = e.max[t], !0));
    }; const Ht = function (t) {
      let e = ''; s.escKey && t.keyCode === 27 ? e = 'close' : s.arrowKeys && (t.keyCode === 37 ? e = 'prev' : t.keyCode === 39 && (e = 'next')), e && (t.ctrlKey || t.altKey || t.shiftKey || t.metaKey || (t.preventDefault ? t.preventDefault() : t.returnValue = !1, r[e]()));
    }; const Bt = function (t) {
      t && (G || X || it || B) && (t.preventDefault(), t.stopPropagation());
    }; const jt = function () {
      r.setScrollOffset(0, o.getScrollY());
    }; const qt = {}; let Zt = 0; const Xt = function (t) {
      qt[t] && (qt[t].raf && T(qt[t].raf), Zt--, delete qt[t]);
    }; const Gt = function (t) {
      qt[t] && Xt(t), qt[t] || (Zt++, qt[t] = {});
    }; const Yt = function () {
      for (const t in qt) {
        qt.hasOwnProperty(t) && Xt(t);
      }
    }; const Kt = function (t, e, i, n, o, r, s) {
      let a; const l = Pt(); Gt(t); const c = function () {
        if (qt[t]) {
          if ((a = Pt() - l) >= n) {
            return Xt(t), r(i), void (s && s());
          } r((i - e) * o(a / n) + e), qt[t].raf = k(c);
        }
      }; c();
    }; const $t = { shout: Dt, listen: Et, viewportSize: ht, options: s, isMainScrollAnimating() {
      return it;
    }, getZoomLevel() {
      return g;
    }, getCurrentIndex() {
      return u;
    }, isDragging() {
      return q;
    }, isZooming() {
      return J;
    }, setScrollOffset(t, e) {
      ft.x = t, N = ft.y = e, Dt('updateScrollOffset', ft);
    }, applyZoomPan(t, e, i, n) {
      dt.x = e, dt.y = i, g = t, _t(n);
    }, init() {
      if (!a && !l) {
        let i; r.framework = o, r.template = t, r.bg = o.getChildByClass(t, 'pswp__bg'), M = t.className, a = !0, O = o.detectFeatures(), k = O.raf, T = O.caf, A = O.transform, F = O.oldIE, r.scrollWrap = o.getChildByClass(t, 'pswp__scroll-wrap'), r.container = o.getChildByClass(r.scrollWrap, 'pswp__container'), d = r.container.style, r.itemHolders = S = [{ el: r.container.children[0], wrap: 0, index: -1 }, { el: r.container.children[1], wrap: 0, index: -1 }, { el: r.container.children[2], wrap: 0, index: -1 }], S[0].el.style.display = S[2].el.style.display = 'none', (function () {
          if (A) {
            const e = O.perspective && !I; return y = `translate${ e ? '3d(' : '('}`, void (x = O.perspective ? ', 0px)' : ')');
          }A = 'left', o.addClass(t, 'pswp--ie'), kt = function (t, e) {
            e.left = `${t}px`;
          }, It = function (t) {
            const e = t.fitRatio > 1 ? 1 : t.fitRatio; const i = t.container.style; const n = e * t.w; const o = e * t.h; i.width = `${n}px`, i.height = `${o}px`, i.left = `${t.initialPosition.x}px`, i.top = `${t.initialPosition.y}px`;
          }, _t = function () {
            if (et) {
              const t = et; const e = r.currItem; const i = e.fitRatio > 1 ? 1 : e.fitRatio; const n = i * e.w; const o = i * e.h; t.width = `${n}px`, t.height = `${o}px`, t.left = `${dt.x}px`, t.top = `${dt.y}px`;
            }
          };
        }()), m = { resize: r.updateSize, orientationchange() {
          clearTimeout(U), U = setTimeout(() => {
            ht.x !== r.scrollWrap.clientWidth && r.updateSize();
          }, 500);
        }, scroll: jt, keydown: Ht, click: Bt }; const n = O.isOldIOSPhone || O.isOldAndroid || O.isMobileOpera; for (O.animationName && O.transform && !n || (s.showAnimationDuration = s.hideAnimationDuration = 0), i = 0; i < yt.length; i++) {
          r[`init${yt[i]}`]();
        } if (e) {
          (r.ui = new e(r, o)).init();
        }Dt('firstUpdate'), u = u || s.index || 0, (isNaN(u) || u < 0 || u >= Ve()) && (u = 0), r.currItem = We(u), (O.isOldIOSPhone || O.isOldAndroid) && (vt = !1), t.setAttribute('aria-hidden', 'false'), s.modal && (vt ? t.style.position = 'fixed' : (t.style.position = 'absolute', t.style.top = `${o.getScrollY()}px`)), void 0 === N && (Dt('initialLayout'), N = L = o.getScrollY()); let c = 'pswp--open '; for (s.mainClass && (c += `${s.mainClass} `), s.showHideOpacity && (c += 'pswp--animate_opacity '), c += I ? 'pswp--touch' : 'pswp--notouch', c += O.animationName ? ' pswp--css_animation' : '', c += O.svg ? ' pswp--svg' : '', o.addClass(t, c), r.updateSize(), h = -1, gt = null, i = 0; i < 3; i++) {
          kt((i + h) * mt.x, S[i].el.style);
        }F || o.bind(r.scrollWrap, f, r), Et('initialZoomInEnd', () => {
          r.setContent(S[0], u - 1), r.setContent(S[2], u + 1), S[0].el.style.display = S[2].el.style.display = 'block', s.focus && t.focus(), o.bind(document, 'keydown', r), O.transform && o.bind(r.scrollWrap, 'click', r), s.mouseUsed || o.bind(document, 'mousemove', Ot), o.bind(window, 'resize scroll orientationchange', r), Dt('bindEvents');
        }), r.setContent(S[1], u), r.updateCurrItem(), Dt('afterInit'), vt || (b = setInterval(() => {
          Zt || q || J || g !== r.currItem.initialZoomLevel || r.updateSize();
        }, 1e3)), o.addClass(t, 'pswp--visible');
      }
    }, close() {
      a && (a = !1, l = !0, Dt('close'), o.unbind(window, 'resize scroll orientationchange', r), o.unbind(window, 'scroll', m.scroll), o.unbind(document, 'keydown', r), o.unbind(document, 'mousemove', Ot), O.transform && o.unbind(r.scrollWrap, 'click', r), q && o.unbind(window, p, r), clearTimeout(U), Dt('unbindEvents'), He(r.currItem, null, !0, r.destroy));
    }, destroy() {
      Dt('destroy'), Ne && clearTimeout(Ne), t.setAttribute('aria-hidden', 'true'), t.className = M, b && clearInterval(b), o.unbind(r.scrollWrap, f, r), o.unbind(window, 'scroll', r), fe(), Yt(), Ct = null;
    }, panTo(t, e, i) {
      i || (t > tt.min.x ? t = tt.min.x : t < tt.max.x && (t = tt.max.x), e > tt.min.y ? e = tt.min.y : e < tt.max.y && (e = tt.max.y)), dt.x = t, dt.y = e, _t();
    }, handleEvent(t) {
      t = t || window.event, m[t.type] && m[t.type](t);
    }, goTo(t) {
      const e = (t = St(t)) - u; gt = e, u = t, r.currItem = We(u), pt -= e, Tt(mt.x * pt), Yt(), it = !1, r.updateCurrItem();
    }, next() {
      r.goTo(u + 1);
    }, prev() {
      r.goTo(u - 1);
    }, updateCurrZoomItem(t) {
      if (t && Dt('beforeChange', 0), S[1].el.children.length) {
        const e = S[1].el.children[0]; et = o.hasClass(e, 'pswp__zoom-wrap') ? e.style : null;
      } else {
        et = null;
      }tt = r.currItem.bounds, v = g = r.currItem.initialZoomLevel, dt.x = tt.center.x, dt.y = tt.center.y, t && Dt('afterChange');
    }, invalidateCurrItems() {
      w = !0; for (let t = 0; t < 3; t++) {
        S[t].item && (S[t].item.needsUpdate = !0);
      }
    }, updateCurrItem(t) {
      if (gt !== 0) {
        let e; let i = Math.abs(gt); if (!(t && i < 2)) {
          r.currItem = We(u), bt = !1, Dt('beforeChange', gt), i >= 3 && (h += gt + (gt > 0 ? -3 : 3), i = 3); for (let n = 0; n < i; n++) {
            gt > 0 ? (e = S.shift(), S[2] = e, h++, kt((h + 2) * mt.x, e.el.style), r.setContent(e, u - i + n + 1 + 1)) : (e = S.pop(), S.unshift(e), h--, kt(h * mt.x, e.el.style), r.setContent(e, u + i - n - 1 - 1));
          } if (et && Math.abs(gt) === 1) {
            const o = We(C); o.initialZoomLevel !== g && (Ze(o, ht), Ke(o), It(o));
          }gt = 0, r.updateCurrZoomItem(), C = u, Dt('afterChange');
        }
      }
    }, updateSize(e) {
      if (!vt && s.modal) {
        const i = o.getScrollY(); if (N !== i && (t.style.top = `${i}px`, N = i), !e && xt.x === window.innerWidth && xt.y === window.innerHeight) {
          return;
        } xt.x = window.innerWidth, xt.y = window.innerHeight, t.style.height = `${xt.y}px`;
      } if (ht.x = r.scrollWrap.clientWidth, ht.y = r.scrollWrap.clientHeight, jt(), mt.x = ht.x + Math.round(ht.x * s.spacing), mt.y = ht.y, Tt(mt.x * pt), Dt('beforeResize'), void 0 !== h) {
        for (var n, a, l, c = 0; c < 3; c++) {
          n = S[c], kt((c + h) * mt.x, n.el.style), l = u + c - 1, s.loop && Ve() > 2 && (l = St(l)), (a = We(l)) && (w || a.needsUpdate || !a.bounds) ? (r.cleanSlide(a), r.setContent(n, l), c === 1 && (r.currItem = a, r.updateCurrZoomItem(!0)), a.needsUpdate = !1) : n.index === -1 && l >= 0 && r.setContent(n, l), a && a.container && (Ze(a, ht), Ke(a), It(a));
        }w = !1;
      }v = g = r.currItem.initialZoomLevel, (tt = r.currItem.bounds) && (dt.x = tt.center.x, dt.y = tt.center.y, _t(!0)), Dt('resize');
    }, zoomTo(t, e, i, n, r) {
      e && (v = g, de.x = Math.abs(e.x) - dt.x, de.y = Math.abs(e.y) - dt.y, Lt(ut, dt)); const s = Ut(t, !1); const a = {}; Vt('x', s, a, t), Vt('y', s, a, t); const l = g; const c = dt.x; const u = dt.y; Ft(a); const d = function (e) {
        e === 1 ? (g = t, dt.x = a.x, dt.y = a.y) : (g = (t - l) * e + l, dt.x = (a.x - c) * e + c, dt.y = (a.y - u) * e + u), r && r(e), _t(e === 1);
      }; i ? Kt('customZoomTo', 0, 1, i, n || o.easing.sine.inOut, d) : d(1);
    } }; const Jt = {}; const Qt = {}; const te = {}; const ee = {}; const ie = {}; const ne = []; const oe = {}; let re = []; const se = {}; let ae = 0; const le = { x: 0, y: 0 }; let ce = 0; var ue = { x: 0, y: 0 }; var de = { x: 0, y: 0 }; const he = { x: 0, y: 0 }; const pe = function (t, e) {
      return se.x = Math.abs(t.x - e.x), se.y = Math.abs(t.y - e.y), Math.sqrt(se.x * se.x + se.y * se.y);
    }; var fe = function () {
      Y && (T(Y), Y = null);
    }; const me = function () {
      q && (Y = k(me), _e());
    }; const ge = function (t, e) {
      return !(!t || t === document) && (!(t.getAttribute('class') && t.getAttribute('class').includes('pswp__scroll-wrap')) && (e(t) ? t : ge(t.parentNode, e)));
    }; const ve = {}; const ye = function (t, e) {
      return ve.prevent = !ge(t.target, s.isClickableElement), Dt('preventDragEvent', t, e, ve), ve.prevent;
    }; const xe = function (t, e) {
      return e.x = t.pageX, e.y = t.pageY, e.id = t.identifier, e;
    }; const be = function (t, e, i) {
      i.x = 0.5 * (t.x + e.x), i.y = 0.5 * (t.y + e.y);
    }; const we = function () {
      const t = dt.y - r.currItem.initialPosition.y; return 1 - Math.abs(t / (ht.y / 2));
    }; const Se = {}; const Ce = {}; const Ee = []; const De = function (t) {
      for (;Ee.length > 0;) {
        Ee.pop();
      } return _
        ? (lt = 0, ne.forEach((t) => {
            lt === 0 ? Ee[0] = t : lt === 1 && (Ee[1] = t), lt++;
          }))
        : t.type.includes('touch') ? t.touches && t.touches.length > 0 && (Ee[0] = xe(t.touches[0], Se), t.touches.length > 1 && (Ee[1] = xe(t.touches[1], Ce))) : (Se.x = t.pageX, Se.y = t.pageY, Se.id = '', Ee[0] = Se), Ee;
    }; const Pe = function (t, e) {
      let i; let n; let o; let a; let l = dt[t] + e[t]; const c = e[t] > 0; const u = ue.x + e.x; const d = ue.x - oe.x; if (i = l > tt.min[t] || l < tt.max[t] ? s.panEndFriction : 1, l = dt[t] + e[t] * i, (s.allowPanToNext || g === r.currItem.initialZoomLevel) && (et ? nt !== 'h' || t !== 'x' || X || (c ? (l > tt.min[t] && (i = s.panEndFriction, tt.min[t] - l, n = tt.min[t] - ut[t]), (n <= 0 || d < 0) && Ve() > 1 ? (a = u, d < 0 && u > oe.x && (a = oe.x)) : tt.min.x !== tt.max.x && (o = l)) : (l < tt.max[t] && (i = s.panEndFriction, l - tt.max[t], n = ut[t] - tt.max[t]), (n <= 0 || d > 0) && Ve() > 1 ? (a = u, d > 0 && u < oe.x && (a = oe.x)) : tt.min.x !== tt.max.x && (o = l))) : a = u, t === 'x')) {
        return void 0 !== a && (Tt(a, !0), K = a !== oe.x), tt.min.x !== tt.max.x && (void 0 !== o ? dt.x = o : K || (dt.x += e.x * i)), void 0 !== a;
      }

      it || K || g > r.currItem.fitRatio && (dt[t] += e[t] * i);
    }; const ze = function (t) {
      if (!(t.type === 'mousedown' && t.button > 0)) {
        if (Re) {
          t.preventDefault();
        } else if (!j || t.type !== 'mousedown') {
          if (ye(t, !0) && t.preventDefault(), Dt('pointerDown'), _) {
            let e = o.arraySearch(ne, t.pointerId, 'id'); e < 0 && (e = ne.length), ne[e] = { x: t.pageX, y: t.pageY, id: t.pointerId };
          } const i = De(t); const n = i.length; $ = null, Yt(), q && n !== 1 || (q = ot = !0, o.bind(window, p, r), H = at = rt = B = K = G = Z = X = !1, nt = null, Dt('firstTouchStart', i), Lt(ut, dt), ct.x = ct.y = 0, Lt(ee, i[0]), Lt(ie, ee), oe.x = mt.x * pt, re = [{ x: ee.x, y: ee.y }], W = R = Pt(), Ut(g, !0), fe(), me()), !J && n > 1 && !it && !K && (v = g, X = !1, J = Z = !0, ct.y = ct.x = 0, Lt(ut, dt), Lt(Jt, i[0]), Lt(Qt, i[1]), be(Jt, Qt, he), de.x = Math.abs(he.x) - dt.x, de.y = Math.abs(he.y) - dt.y, Q = pe(Jt, Qt));
        }
      }
    }; const Ae = function (t) {
      if (t.preventDefault(), _) {
        const e = o.arraySearch(ne, t.pointerId, 'id'); if (e > -1) {
          const i = ne[e]; i.x = t.pageX, i.y = t.pageY;
        }
      } if (q) {
        const n = De(t); if (nt || G || J) {
          $ = n;
        } else if (ue.x !== mt.x * pt) {
          nt = 'h';
        } else {
          const r = Math.abs(n[0].x - ee.x) - Math.abs(n[0].y - ee.y); Math.abs(r) >= 10 && (nt = r > 0 ? 'h' : 'v', $ = n);
        }
      }
    }; var _e = function () {
      if ($) {
        const t = $.length; if (t !== 0) {
          if (Lt(Jt, $[0]), te.x = Jt.x - ee.x, te.y = Jt.y - ee.y, J && t > 1) {
            if (ee.x = Jt.x, ee.y = Jt.y, !te.x && !te.y && (function (t, e) {
              return t.x === e.x && t.y === e.y;
            }($[1], Qt))) {
              return;
            } Lt(Qt, $[1]), X || (X = !0, Dt('zoomGestureStarted')); const e = pe(Jt, Qt); let i = Le(e); i > r.currItem.initialZoomLevel + r.currItem.initialZoomLevel / 15 && (at = !0); let n = 1; const o = Rt(); const a = Wt(); if (i < o) {
              if (s.pinchToClose && !at && v <= r.currItem.initialZoomLevel) {
                const l = 1 - (o - i) / (o / 1.2); zt(l), Dt('onPinchClose', l), rt = !0;
              } else {
                (n = (o - i) / o) > 1 && (n = 1), i = o - n * (o / 3);
              }
            } else {
              i > a && ((n = (i - a) / (6 * o)) > 1 && (n = 1), i = a + n * o);
            }n < 0 && (n = 0), e, be(Jt, Qt, le), ct.x += le.x - he.x, ct.y += le.y - he.y, Lt(he, le), dt.x = Mt('x', i), dt.y = Mt('y', i), H = i > g, g = i, _t();
          } else {
            if (!nt) {
              return;
            } if (ot && (ot = !1, Math.abs(te.x) >= 10 && (te.x -= $[0].x - ie.x), Math.abs(te.y) >= 10 && (te.y -= $[0].y - ie.y)), ee.x = Jt.x, ee.y = Jt.y, te.x === 0 && te.y === 0) {
              return;
            } if (nt === 'v' && s.closeOnVerticalDrag && s.scaleMode === 'fit' && g === r.currItem.initialZoomLevel) {
              ct.y += te.y, dt.y += te.y; const c = we(); return B = !0, Dt('onVerticalDrag', c), zt(c), void _t();
            }!(function (t, e, i) {
              if (t - W > 50) {
                const n = re.length > 2 ? re.shift() : {}; n.x = e, n.y = i, re.push(n), W = t;
              }
            }(Pt(), Jt.x, Jt.y)), G = !0, tt = r.currItem.bounds, Pe('x', te) || (Pe('y', te), Ft(dt), _t());
          }
        }
      }
    }; const Ie = function (t) {
      if (O.isOldAndroid) {
        if (j && t.type === 'mouseup') {
          return;
        } t.type.includes('touch') && (clearTimeout(j), j = setTimeout(() => {
          j = 0;
        }, 600));
      } let e; if (Dt('pointerUp'), ye(t, !1) && t.preventDefault(), _) {
        const i = o.arraySearch(ne, t.pointerId, 'id'); if (i > -1) {
          if (e = ne.splice(i, 1)[0], navigator.msPointerEnabled) {
            e.type = { 4: 'mouse', 2: 'touch', 3: 'pen' }[t.pointerType], e.type || (e.type = t.pointerType || 'mouse');
          } else {
            e.type = t.pointerType || 'mouse';
          }
        }
      } let n; const a = De(t); let l = a.length; if (t.type === 'mouseup' && (l = 0), l === 2) {
        return $ = null, !0;
      } l === 1 && Lt(ie, a[0]), l !== 0 || nt || it || (e || (t.type === 'mouseup' ? e = { x: t.pageX, y: t.pageY, type: 'mouse' } : t.changedTouches && t.changedTouches[0] && (e = { x: t.changedTouches[0].pageX, y: t.changedTouches[0].pageY, type: 'touch' })), Dt('touchRelease', t, e)); let c = -1; if (l === 0 && (q = !1, o.unbind(window, p, r), fe(), J ? c = 0 : ce !== -1 && (c = Pt() - ce)), ce = l === 1 ? Pt() : -1, n = c !== -1 && c < 150 ? 'zoom' : 'swipe', J && l < 2 && (J = !1, l === 1 && (n = 'zoomPointerUp'), Dt('zoomGestureEnded')), $ = null, G || X || it || B) {
        if (Yt(), V || (V = ke()), V.calculateSwipeSpeed('x'), B) {
          if (we() < s.verticalDragRange) {
            r.close();
          } else {
            const u = dt.y; const d = st; Kt('verticalDrag', 0, 1, 300, o.easing.cubic.out, (t) => {
              dt.y = (r.currItem.initialPosition.y - u) * t + u, zt((1 - d) * t + d), _t();
            }), Dt('onVerticalDrag', 1);
          }
        } else {
          if ((K || it) && l === 0) {
            if (Me(n, V)) {
              return;
            } n = 'zoomPointerUp';
          }

          it || (n === 'swipe' ? !K && g > r.currItem.fitRatio && Te(V) : Fe());
        }
      }
    }; var ke = function () {
      let t; let e; var i = { lastFlickOffset: {}, lastFlickDist: {}, lastFlickSpeed: {}, slowDownRatio: {}, slowDownRatioReverse: {}, speedDecelerationRatio: {}, speedDecelerationRatioAbs: {}, distanceOffset: {}, backAnimDestination: {}, backAnimStarted: {}, calculateSwipeSpeed(n) {
        re.length > 1 ? (t = Pt() - W + 50, e = re[re.length - 2][n]) : (t = Pt() - R, e = ie[n]), i.lastFlickOffset[n] = ee[n] - e, i.lastFlickDist[n] = Math.abs(i.lastFlickOffset[n]), i.lastFlickDist[n] > 20 ? i.lastFlickSpeed[n] = i.lastFlickOffset[n] / t : i.lastFlickSpeed[n] = 0, Math.abs(i.lastFlickSpeed[n]) < 0.1 && (i.lastFlickSpeed[n] = 0), i.slowDownRatio[n] = 0.95, i.slowDownRatioReverse[n] = 1 - i.slowDownRatio[n], i.speedDecelerationRatio[n] = 1;
      }, calculateOverBoundsAnimOffset(t, e) {
        i.backAnimStarted[t] || (dt[t] > tt.min[t] ? i.backAnimDestination[t] = tt.min[t] : dt[t] < tt.max[t] && (i.backAnimDestination[t] = tt.max[t]), void 0 !== i.backAnimDestination[t] && (i.slowDownRatio[t] = 0.7, i.slowDownRatioReverse[t] = 1 - i.slowDownRatio[t], i.speedDecelerationRatioAbs[t] < 0.05 && (i.lastFlickSpeed[t] = 0, i.backAnimStarted[t] = !0, Kt(`bounceZoomPan${t}`, dt[t], i.backAnimDestination[t], e || 300, o.easing.sine.out, (e) => {
          dt[t] = e, _t();
        }))));
      }, calculateAnimOffset(t) {
        i.backAnimStarted[t] || (i.speedDecelerationRatio[t] = i.speedDecelerationRatio[t] * (i.slowDownRatio[t] + i.slowDownRatioReverse[t] - i.slowDownRatioReverse[t] * i.timeDiff / 10), i.speedDecelerationRatioAbs[t] = Math.abs(i.lastFlickSpeed[t] * i.speedDecelerationRatio[t]), i.distanceOffset[t] = i.lastFlickSpeed[t] * i.speedDecelerationRatio[t] * i.timeDiff, dt[t] += i.distanceOffset[t]);
      }, panAnimLoop() {
        if (qt.zoomPan && (qt.zoomPan.raf = k(i.panAnimLoop), i.now = Pt(), i.timeDiff = i.now - i.lastNow, i.lastNow = i.now, i.calculateAnimOffset('x'), i.calculateAnimOffset('y'), _t(), i.calculateOverBoundsAnimOffset('x'), i.calculateOverBoundsAnimOffset('y'), i.speedDecelerationRatioAbs.x < 0.05 && i.speedDecelerationRatioAbs.y < 0.05)) {
          return dt.x = Math.round(dt.x), dt.y = Math.round(dt.y), _t(), void Xt('zoomPan');
        }
      } }; return i;
    }; var Te = function (t) {
      if (t.calculateSwipeSpeed('y'), tt = r.currItem.bounds, t.backAnimDestination = {}, t.backAnimStarted = {}, Math.abs(t.lastFlickSpeed.x) <= 0.05 && Math.abs(t.lastFlickSpeed.y) <= 0.05) {
        return t.speedDecelerationRatioAbs.x = t.speedDecelerationRatioAbs.y = 0, t.calculateOverBoundsAnimOffset('x'), t.calculateOverBoundsAnimOffset('y'), !0;
      } Gt('zoomPan'), t.lastNow = Pt(), t.panAnimLoop();
    }; var Me = function (t, e) {
      let i, n, a; if (it || (ae = u), t === 'swipe') {
        const l = ee.x - ie.x; const c = e.lastFlickDist.x < 10; l > 30 && (c || e.lastFlickOffset.x > 20) ? n = -1 : l < -30 && (c || e.lastFlickOffset.x < -20) && (n = 1);
      }n && ((u += n) < 0 ? (u = s.loop ? Ve() - 1 : 0, a = !0) : u >= Ve() && (u = s.loop ? 0 : Ve() - 1, a = !0), a && !s.loop || (gt += n, pt -= n, i = !0)); let d; const h = mt.x * pt; const p = Math.abs(h - ue.x); return i || h > ue.x == e.lastFlickSpeed.x > 0 ? (d = Math.abs(e.lastFlickSpeed.x) > 0 ? p / Math.abs(e.lastFlickSpeed.x) : 333, d = Math.min(d, 400), d = Math.max(d, 250)) : d = 333, ae === u && (i = !1), it = !0, Dt('mainScrollAnimStart'), Kt('mainScroll', ue.x, h, d, o.easing.cubic.out, Tt, () => {
        Yt(), it = !1, ae = -1, (i || ae !== u) && r.updateCurrItem(), Dt('mainScrollAnimComplete');
      }), i && r.updateCurrItem(!0), i;
    }; var Le = function (t) {
      return 1 / Q * t * v;
    }; var Fe = function () {
      let t = g; const e = Rt(); const i = Wt(); g < e ? t = e : g > i && (t = i); let n; const s = st; return rt && !H && !at && g < e
        ? (r.close(), !0)
        : (rt && (n = function (t) {
            zt((1 - s) * t + s);
          }), r.zoomTo(t, 0, 200, o.easing.cubic.out, n), !0);
    }; wt('Gestures', { publicMethods: { initGestures() {
      const t = function (t, e, i, n, o) {
        E = t + e, D = t + i, P = t + n, z = o ? t + o : '';
      }; (_ = O.pointerEvent) && O.touch && (O.touch = !1), _ ? navigator.msPointerEnabled ? t('MSPointer', 'Down', 'Move', 'Up', 'Cancel') : t('pointer', 'down', 'move', 'up', 'cancel') : O.touch ? (t('touch', 'start', 'move', 'end', 'cancel'), I = !0) : t('mouse', 'down', 'move', 'up'), p = `${D} ${P} ${z}`, f = E, _ && !I && (I = navigator.maxTouchPoints > 1 || navigator.msMaxTouchPoints > 1), r.likelyTouchDevice = I, m[E] = ze, m[D] = Ae, m[P] = Ie, z && (m[z] = m[P]), O.touch && (f += ' mousedown', p += ' mousemove mouseup', m.mousedown = m[E], m.mousemove = m[D], m.mouseup = m[P]), I || (s.allowPanToNext = !1);
    } } }); let Ne; let Oe; let Ue; let Re; let We; let Ve; var He = function (e, i, n, a) {
      let l; Ne && clearTimeout(Ne), Re = !0, Ue = !0, e.initialLayout ? (l = e.initialLayout, e.initialLayout = null) : l = s.getThumbBoundsFn && s.getThumbBoundsFn(u); const d = n ? s.hideAnimationDuration : s.showAnimationDuration; const h = function () {
        Xt('initialZoom'), n ? (r.template.removeAttribute('style'), r.bg.removeAttribute('style')) : (zt(1), i && (i.style.display = 'block'), o.addClass(t, 'pswp--animated-in'), Dt(`initialZoom${n ? 'OutEnd' : 'InEnd'}`)), a && a(), Re = !1;
      }; if (!d || !l || void 0 === l.x) {
        return Dt(`initialZoom${n ? 'Out' : 'In'}`), g = e.initialZoomLevel, Lt(dt, e.initialPosition), _t(), t.style.opacity = n ? 0 : 1, zt(1), void (d
          ? setTimeout(() => {
            h();
          }, d)
          : h());
      } let p, f; p = c, f = !r.currItem.src || r.currItem.loadError || s.showHideOpacity, e.miniImg && (e.miniImg.style.webkitBackfaceVisibility = 'hidden'), n || (g = l.w / e.w, dt.x = l.x, dt.y = l.y - L, r[f ? 'template' : 'bg'].style.opacity = 0.001, _t()), Gt('initialZoom'), n && !p && o.removeClass(t, 'pswp--animated-in'), f && (n
        ? o[`${p ? 'remove' : 'add'}Class`](t, 'pswp--animate_opacity')
        : setTimeout(() => {
          o.addClass(t, 'pswp--animate_opacity');
        }, 30)), Ne = setTimeout(() => {
        if (Dt(`initialZoom${n ? 'Out' : 'In'}`), n) {
          const i = l.w / e.w; const r = { x: dt.x, y: dt.y }; const s = g; const a = st; const c = function (e) {
            e === 1 ? (g = i, dt.x = l.x, dt.y = l.y - N) : (g = (i - s) * e + s, dt.x = (l.x - r.x) * e + r.x, dt.y = (l.y - N - r.y) * e + r.y), _t(), f ? t.style.opacity = 1 - e : zt(a - e * a);
          }; p ? Kt('initialZoom', 0, 1, d, o.easing.cubic.out, c, h) : (c(1), Ne = setTimeout(h, d + 20));
        } else {
          g = e.initialZoomLevel, Lt(dt, e.initialPosition), _t(), zt(1), f ? t.style.opacity = 1 : zt(1), Ne = setTimeout(h, d + 20);
        }
      }, n ? 25 : 90);
    }; const Be = {}; let je = []; const qe = { index: 0, errorMsg: '<div class="pswp__error-msg"><a href="%url%" target="_blank">The image</a> could not be loaded.</div>', forceProgressiveLoading: !1, preload: [1, 1], getNumItemsFn() {
      return Oe.length;
    } }; var Ze = function (t, e, i) {
      if (t.src && !t.loadError) {
        const n = !i; if (n && (t.vGap || (t.vGap = { top: 0, bottom: 0 }), Dt('parseVerticalMargin', t)), Be.x = e.x, Be.y = e.y - t.vGap.top - t.vGap.bottom, n) {
          const o = Be.x / t.w; const r = Be.y / t.h; t.fitRatio = o < r ? o : r; const a = s.scaleMode; a === 'orig' ? i = 1 : a === 'fit' ? i = t.fitRatio : a === 'zoom' && (i = Math.max(t.initialZoomLevel || 1, t.fitRatio)), i > 1 && (i = 1), t.initialZoomLevel = i, t.bounds || (t.bounds = { center: { x: 0, y: 0 }, max: { x: 0, y: 0 }, min: { x: 0, y: 0 } });
        } if (!i) {
          return;
        } return (function (t, e, i) {
          const n = t.bounds; n.center.x = Math.round((Be.x - e) / 2), n.center.y = Math.round((Be.y - i) / 2) + t.vGap.top, n.max.x = e > Be.x ? Math.round(Be.x - e) : n.center.x, n.max.y = i > Be.y ? Math.round(Be.y - i) + t.vGap.top : n.center.y, n.min.x = e > Be.x ? 0 : n.center.x, n.min.y = i > Be.y ? t.vGap.top : n.center.y;
        }(t, t.w * i, t.h * i)), n && i === t.initialZoomLevel && (t.initialPosition = t.bounds.center), t.bounds;
      } return t.w = t.h = 0, t.initialZoomLevel = t.fitRatio = 1, t.bounds = { center: { x: 0, y: 0 }, max: { x: 0, y: 0 }, min: { x: 0, y: 0 } }, t.initialPosition = t.bounds.center, t.bounds;
    }; const Xe = function (t, e, i, n, o, s) {
      e.loadError || n && (e.imageAppended = !0, Ke(e, n, e === r.currItem && bt), i.appendChild(n), s && setTimeout(() => {
        e && e.loaded && e.placeholder && (e.placeholder.style.display = 'none', e.placeholder = null);
      }, 500));
    }; const Ge = function (t) {
      t.loading = !0, t.loaded = !1; let e = t.img = o.createEl('pswp__img', 'img'); const i = function () {
        t.loading = !1, t.loaded = !0, t.loadComplete ? t.loadComplete(t) : t.img = null, e.onload = e.onerror = null, e = null;
      }; return e.onload = i, e.onerror = function () {
        t.loadError = !0, i();
      }, e.src = t.src, e;
    }; const Ye = function (t, e) {
      if (t.src && t.loadError && t.container) {
        return e && (t.container.innerHTML = ''), t.container.innerHTML = s.errorMsg.replace('%url%', t.src), !0;
      }
    }; var Ke = function (t, e, i) {
      if (t.src) {
        e || (e = t.container.lastChild); const n = i ? t.w : Math.round(t.w * t.fitRatio); const o = i ? t.h : Math.round(t.h * t.fitRatio); t.placeholder && !t.loaded && (t.placeholder.style.width = `${n}px`, t.placeholder.style.height = `${o}px`), e.style.width = `${n}px`, e.style.height = `${o}px`;
      }
    }; const $e = function () {
      if (je.length) {
        for (var t, e = 0; e < je.length; e++) {
          (t = je[e]).holder.index === t.index && Xe(t.index, t.item, t.baseDiv, t.img, 0, t.clearPlaceholder);
        }je = [];
      }
    }; wt('Controller', { publicMethods: { lazyLoadItem(t) {
      t = St(t); const e = We(t); e && (!e.loaded && !e.loading || w) && (Dt('gettingData', t, e), e.src && Ge(e));
    }, initController() {
      o.extend(s, qe, !0), r.items = Oe = i, We = r.getItemAt, Ve = s.getNumItemsFn, s.loop, Ve() < 3 && (s.loop = !1), Et('beforeChange', (t) => {
        let e; const i = s.preload; const n = t === null || t >= 0; const o = Math.min(i[0], Ve()); const a = Math.min(i[1], Ve()); for (e = 1; e <= (n ? a : o); e++) {
          r.lazyLoadItem(u + e);
        } for (e = 1; e <= (n ? o : a); e++) {
          r.lazyLoadItem(u - e);
        }
      }), Et('initialLayout', () => {
        r.currItem.initialLayout = s.getThumbBoundsFn && s.getThumbBoundsFn(u);
      }), Et('mainScrollAnimComplete', $e), Et('initialZoomInEnd', $e), Et('destroy', () => {
        for (var t, e = 0; e < Oe.length; e++) {
          (t = Oe[e]).container && (t.container = null), t.placeholder && (t.placeholder = null), t.img && (t.img = null), t.preloader && (t.preloader = null), t.loadError && (t.loaded = t.loadError = !1);
        }je = null;
      });
    }, getItemAt(t) {
      return t >= 0 && (void 0 !== Oe[t] && Oe[t]);
    }, allowProgressiveImg() {
      return s.forceProgressiveLoading || !I || s.mouseUsed || screen.width > 1200;
    }, setContent(t, e) {
      s.loop && (e = St(e)); const i = r.getItemAt(t.index); i && (i.container = null); let n; const l = r.getItemAt(e); if (l) {
        Dt('gettingData', e, l), t.index = e, t.item = l; const c = l.container = o.createEl('pswp__zoom-wrap'); if (!l.src && l.html && (l.html.tagName ? c.appendChild(l.html) : c.innerHTML = l.html), Ye(l), Ze(l, ht), !l.src || l.loadError || l.loaded) {
          l.src && !l.loadError && ((n = o.createEl('pswp__img', 'img')).style.opacity = 1, n.src = l.src, Ke(l, n), Xe(0, l, c, n));
        } else {
          if (l.loadComplete = function (i) {
            if (a) {
              if (t && t.index === e) {
                if (Ye(i, !0)) {
                  return i.loadComplete = i.img = null, Ze(i, ht), It(i), void (t.index === u && r.updateCurrZoomItem());
                } i.imageAppended ? !Re && i.placeholder && (i.placeholder.style.display = 'none', i.placeholder = null) : O.transform && (it || Re) ? je.push({ item: i, baseDiv: c, img: i.img, index: e, holder: t, clearPlaceholder: !0 }) : Xe(0, i, c, i.img, 0, !0);
              }i.loadComplete = null, i.img = null, Dt('imageLoadComplete', e, i);
            }
          }, o.features.transform) {
            let d = 'pswp__img pswp__img--placeholder'; d += l.msrc ? '' : ' pswp__img--placeholder--blank'; const h = o.createEl(d, l.msrc ? 'img' : ''); l.msrc && (h.src = l.msrc), Ke(l, h), c.appendChild(h), l.placeholder = h;
          }l.loading || Ge(l), r.allowProgressiveImg() && (!Ue && O.transform ? je.push({ item: l, baseDiv: c, img: l.img, index: e, holder: t }) : Xe(0, l, c, l.img, 0, !0));
        }Ue || e !== u ? It(l) : (et = c.style, He(l, n || l.img)), t.el.innerHTML = '', t.el.appendChild(c);
      } else {
        t.el.innerHTML = '';
      }
    }, cleanSlide(t) {
      t.img && (t.img.onload = t.img.onerror = null), t.loaded = t.loading = t.img = t.imageAppended = !1;
    } } }); let Je; let Qe; let ti = {}; const ei = function (t, e, i) {
      const n = document.createEvent('CustomEvent'); const o = { origEvent: t, target: t.target, releasePoint: e, pointerType: i || 'touch' }; n.initCustomEvent('pswpTap', !0, !0, o), t.target.dispatchEvent(n);
    }; wt('Tap', { publicMethods: { initTap() {
      Et('firstTouchStart', r.onTapStart), Et('touchRelease', r.onTapRelease), Et('destroy', () => {
        ti = {}, Je = null;
      });
    }, onTapStart(t) {
      t.length > 1 && (clearTimeout(Je), Je = null);
    }, onTapRelease(t, e) {
      let i, n; if (e && (!G && !Z && !Zt)) {
        const r = e; if (Je && (clearTimeout(Je), Je = null, i = r, n = ti, Math.abs(i.x - n.x) < 25 && Math.abs(i.y - n.y) < 25)) {
          return void Dt('doubleTap', r);
        } if (e.type === 'mouse') {
          return void ei(t, e, 'mouse');
        } if (t.target.tagName.toUpperCase() === 'BUTTON' || o.hasClass(t.target, 'pswp__single-tap')) {
          return void ei(t, e);
        } Lt(ti, r), Je = setTimeout(() => {
          ei(t, e), Je = null;
        }, 300);
      }
    } } }), wt('DesktopZoom', { publicMethods: { initDesktopZoom() {
      F || (I
        ? Et('mouseUsed', () => {
          r.setupDesktopZoom();
        })
        : r.setupDesktopZoom(!0));
    }, setupDesktopZoom(e) {
      Qe = {}; const i = 'wheel mousewheel DOMMouseScroll'; Et('bindEvents', () => {
        o.bind(t, i, r.handleMouseWheel);
      }), Et('unbindEvents', () => {
        Qe && o.unbind(t, i, r.handleMouseWheel);
      }), r.mouseZoomedIn = !1; let n; const s = function () {
        r.mouseZoomedIn && (o.removeClass(t, 'pswp--zoomed-in'), r.mouseZoomedIn = !1), g < 1 ? o.addClass(t, 'pswp--zoom-allowed') : o.removeClass(t, 'pswp--zoom-allowed'), a();
      }; var a = function () {
        n && (o.removeClass(t, 'pswp--dragging'), n = !1);
      }; Et('resize', s), Et('afterChange', s), Et('pointerDown', () => {
        r.mouseZoomedIn && (n = !0, o.addClass(t, 'pswp--dragging'));
      }), Et('pointerUp', a), e || s();
    }, handleMouseWheel(t) {
      if (g <= r.currItem.fitRatio) {
        return s.modal && (!s.closeOnScroll || Zt || q ? t.preventDefault() : A && Math.abs(t.deltaY) > 2 && (c = !0, r.close())), !0;
      } if (t.stopPropagation(), Qe.x = 0, 'deltaX' in t) {
        t.deltaMode === 1 ? (Qe.x = 18 * t.deltaX, Qe.y = 18 * t.deltaY) : (Qe.x = t.deltaX, Qe.y = t.deltaY);
      } else if ('wheelDelta' in t) {
        t.wheelDeltaX && (Qe.x = -0.16 * t.wheelDeltaX), t.wheelDeltaY ? Qe.y = -0.16 * t.wheelDeltaY : Qe.y = -0.16 * t.wheelDelta;
      } else {
        if (!('detail' in t)) {
          return;
        } Qe.y = t.detail;
      }Ut(g, !0); const e = dt.x - Qe.x; const i = dt.y - Qe.y; (s.modal || e <= tt.min.x && e >= tt.max.x && i <= tt.min.y && i >= tt.max.y) && t.preventDefault(), r.panTo(e, i);
    }, toggleDesktopZoom(e) {
      e = e || { x: ht.x / 2 + ft.x, y: ht.y / 2 + ft.y }; const i = s.getDoubleTapZoom(!0, r.currItem); const n = g === i; r.mouseZoomedIn = !n, r.zoomTo(n ? r.currItem.initialZoomLevel : i, e, 333), o[`${n ? 'remove' : 'add'}Class`](t, 'pswp--zoomed-in');
    } } }), o.extend(r, $t);
  };
})), (function (t, e) {
  typeof define == 'function' && define.amd ? define(e) : typeof exports == 'object' ? module.exports = e() : t.PhotoSwipeUI_Default = e();
}(this, () => {
  'use strict'; return function (t, e) {
    let i; let n; let o; let r; let s; let a; let l; let c; let u; let d; let h; let p; let f; let m; let g; let v; let y; let x; const b = this; let w = !1; let S = !0; let C = !0; const E = { barsSize: { top: 44, bottom: 'auto' }, closeElClasses: ['item', 'caption', 'zoom-wrap', 'ui', 'top-bar'], timeToIdle: 4e3, timeToIdleOutside: 1e3, loadingIndicatorDelay: 1e3, addCaptionHTMLFn(t, e) {
      return t.title ? (e.children[0].innerHTML = t.title, !0) : (e.children[0].innerHTML = '', !1);
    }, closeEl: !0, captionEl: !0, fullscreenEl: !0, zoomEl: !0, shareEl: !0, counterEl: !0, arrowEl: !0, preloaderEl: !0, tapToClose: !1, tapToToggleControls: !0, clickToCloseNonZoomable: !0, shareButtons: [{ id: 'facebook', label: 'Share on Facebook', url: 'https://www.facebook.com/sharer/sharer.php?u={{url}}' }, { id: 'twitter', label: 'Tweet', url: 'https://twitter.com/intent/tweet?text={{text}}&url={{url}}' }, { id: 'pinterest', label: 'Pin it', url: 'http://www.pinterest.com/pin/create/button/?url={{url}}&media={{image_url}}&description={{text}}' }, { id: 'download', label: 'Download image', url: '{{raw_image_url}}', download: !0 }], getImageURLForShare() {
      return t.currItem.src || '';
    }, getPageURLForShare() {
      return window.location.href;
    }, getTextForShare() {
      return t.currItem.title || '';
    }, indexIndicatorSep: ' / ', fitControlsWidth: 1200 }; const D = function (t) {
      if (v) {
        return !0;
      } t = t || window.event, g.timeToIdle && g.mouseUsed && !u && F(); for (var i, n, o = (t.target || t.srcElement).getAttribute('class') || '', r = 0; r < R.length; r++) {
        (i = R[r]).onTap && o.includes(`pswp__${i.name}`) && (i.onTap(), n = !0);
      } if (n) {
        t.stopPropagation && t.stopPropagation(), v = !0; const s = e.features.isOldAndroid ? 600 : 30; setTimeout(() => {
          v = !1;
        }, s);
      }
    }; const P = function () {
      return !t.likelyTouchDevice || g.mouseUsed || screen.width > g.fitControlsWidth;
    }; const z = function (t, i, n) {
      e[`${n ? 'add' : 'remove'}Class`](t, `pswp__${i}`);
    }; const A = function () {
      const t = g.getNumItemsFn() === 1; t !== m && (z(n, 'ui--one-slide', t), m = t);
    }; const _ = function () {
      z(l, 'share-modal--hidden', C);
    }; const I = function () {
      return (C = !C)
        ? (e.removeClass(l, 'pswp__share-modal--fade-in'), setTimeout(() => {
            C && _();
          }, 300))
        : (_(), setTimeout(() => {
            C || e.addClass(l, 'pswp__share-modal--fade-in');
          }, 30)), C || T(), !1;
    }; const k = function (e) {
      const i = (e = e || window.event).target || e.srcElement; return t.shout('shareLinkClick', e, i), !(!i.href || !i.hasAttribute('download') && (window.open(i.href, 'pswp_share', `scrollbars=yes,resizable=yes,toolbar=no,location=yes,width=550,height=420,top=100,left=${window.screen ? Math.round(screen.width / 2 - 275) : 100}`), C || I(), 1));
    }; var T = function () {
      for (var t, e, i, n, o = '', r = 0; r < g.shareButtons.length; r++) {
        t = g.shareButtons[r], e = g.getImageURLForShare(t), i = g.getPageURLForShare(t), n = g.getTextForShare(t), o += `<a href="${t.url.replace('{{url}}', encodeURIComponent(i)).replace('{{image_url}}', encodeURIComponent(e)).replace('{{raw_image_url}}', e).replace('{{text}}', encodeURIComponent(n))}" target="_blank" class="pswp__share--${t.id}"${t.download ? 'download' : ''}>${t.label}</a>`, g.parseShareButtonOut && (o = g.parseShareButtonOut(t, o));
      }l.children[0].innerHTML = o, l.children[0].onclick = k;
    }; const M = function (t) {
      for (let i = 0; i < g.closeElClasses.length; i++) {
        if (e.hasClass(t, `pswp__${g.closeElClasses[i]}`)) {
          return !0;
        }
      }
    }; let L = 0; var F = function () {
      clearTimeout(x), L = 0, u && b.setIdle(!1);
    }; const N = function (t) {
      const e = (t = t || window.event).relatedTarget || t.toElement; e && e.nodeName !== 'HTML' || (clearTimeout(x), x = setTimeout(() => {
        b.setIdle(!0);
      }, g.timeToIdleOutside));
    }; const O = function (t) {
      p !== t && (z(h, 'preloader--active', !t), p = t);
    }; const U = function (t) {
      const i = t.vGap; if (P()) {
        const s = g.barsSize; if (g.captionEl && s.bottom === 'auto') {
          if (r || ((r = e.createEl('pswp__caption pswp__caption--fake')).appendChild(e.createEl('pswp__caption__center')), n.insertBefore(r, o), e.addClass(n, 'pswp__ui--fit')), g.addCaptionHTMLFn(t, r, !0)) {
            const a = r.clientHeight; i.bottom = Number.parseInt(a, 10) || 44;
          } else {
            i.bottom = s.top;
          }
        } else {
          i.bottom = s.bottom === 'auto' ? 0 : s.bottom;
        }i.top = s.top;
      } else {
        i.top = i.bottom = 0;
      }
    }; var R = [{ name: 'caption', option: 'captionEl', onInit(t) {
      o = t;
    } }, { name: 'share-modal', option: 'shareEl', onInit(t) {
      l = t;
    }, onTap() {
      I();
    } }, { name: 'button--share', option: 'shareEl', onInit(t) {
      a = t;
    }, onTap() {
      I();
    } }, { name: 'button--zoom', option: 'zoomEl', onTap: t.toggleDesktopZoom }, { name: 'counter', option: 'counterEl', onInit(t) {
      s = t;
    } }, { name: 'button--close', option: 'closeEl', onTap: t.close }, { name: 'button--arrow--left', option: 'arrowEl', onTap: t.prev }, { name: 'button--arrow--right', option: 'arrowEl', onTap: t.next }, { name: 'button--fs', option: 'fullscreenEl', onTap() {
      i.isFullscreen() ? i.exit() : i.enter();
    } }, { name: 'preloader', option: 'preloaderEl', onInit(t) {
      h = t;
    } }]; b.init = function () {
      e.extend(t.options, E, !0), g = t.options, n = e.getChildByClass(t.scrollWrap, 'pswp__ui'), d = t.listen, (function () {
        let t; d('onVerticalDrag', (t) => {
          S && t < 0.95 ? b.hideControls() : !S && t >= 0.95 && b.showControls();
        }), d('onPinchClose', (e) => {
          S && e < 0.9 ? (b.hideControls(), t = !0) : t && !S && e > 0.9 && b.showControls();
        }), d('zoomGestureEnded', () => {
          (t = !1) && !S && b.showControls();
        });
      }()), d('beforeChange', b.update), d('doubleTap', (e) => {
        const i = t.currItem.initialZoomLevel; t.getZoomLevel() !== i ? t.zoomTo(i, e, 333) : t.zoomTo(g.getDoubleTapZoom(!1, t.currItem), e, 333);
      }), d('preventDragEvent', (t, e, i) => {
        const n = t.target || t.srcElement; n && n.getAttribute('class') && t.type.includes('mouse') && (n.getAttribute('class').indexOf('__caption') > 0 || /(SMALL|STRONG|EM)/i.test(n.tagName)) && (i.prevent = !1);
      }), d('bindEvents', () => {
        e.bind(n, 'pswpTap click', D), e.bind(t.scrollWrap, 'pswpTap', b.onGlobalTap), t.likelyTouchDevice || e.bind(t.scrollWrap, 'mouseover', b.onMouseOver);
      }), d('unbindEvents', () => {
        C || I(), y && clearInterval(y), e.unbind(document, 'mouseout', N), e.unbind(document, 'mousemove', F), e.unbind(n, 'pswpTap click', D), e.unbind(t.scrollWrap, 'pswpTap', b.onGlobalTap), e.unbind(t.scrollWrap, 'mouseover', b.onMouseOver), i && (e.unbind(document, i.eventK, b.updateFullscreen), i.isFullscreen() && (g.hideAnimationDuration = 0, i.exit()), i = null);
      }), d('destroy', () => {
        g.captionEl && (r && n.removeChild(r), e.removeClass(o, 'pswp__caption--empty')), l && (l.children[0].onclick = null), e.removeClass(n, 'pswp__ui--over-close'), e.addClass(n, 'pswp__ui--hidden'), b.setIdle(!1);
      }), g.showAnimationDuration || e.removeClass(n, 'pswp__ui--hidden'), d('initialZoomIn', () => {
        g.showAnimationDuration && e.removeClass(n, 'pswp__ui--hidden');
      }), d('initialZoomOut', () => {
        e.addClass(n, 'pswp__ui--hidden');
      }), d('parseVerticalMargin', U), (function () {
        let t; let i; let o; const r = function (n) {
          if (n) {
            for (let r = n.length, s = 0; s < r; s++) {
              t = n[s], i = t.className; for (let a = 0; a < R.length; a++) {
                o = R[a], i.includes(`pswp__${o.name}`) && (g[o.option] ? (e.removeClass(t, 'pswp__element--disabled'), o.onInit && o.onInit(t)) : e.addClass(t, 'pswp__element--disabled'));
              }
            }
          }
        }; r(n.children); const s = e.getChildByClass(n, 'pswp__top-bar'); s && r(s.children);
      }()), g.shareEl && a && l && (C = !0), A(), g.timeToIdle && d('mouseUsed', () => {
        e.bind(document, 'mousemove', F), e.bind(document, 'mouseout', N), y = setInterval(() => {
          ++L == 2 && b.setIdle(!0);
        }, g.timeToIdle / 2);
      }), g.fullscreenEl && !e.features.isOldAndroid && (i || (i = b.getFullscreenAPI()), i ? (e.bind(document, i.eventK, b.updateFullscreen), b.updateFullscreen(), e.addClass(t.template, 'pswp--supports-fs')) : e.removeClass(t.template, 'pswp--supports-fs')), g.preloaderEl && (O(!0), d('beforeChange', () => {
        clearTimeout(f), f = setTimeout(() => {
          t.currItem && t.currItem.loading ? (!t.allowProgressiveImg() || t.currItem.img && !t.currItem.img.naturalWidth) && O(!1) : O(!0);
        }, g.loadingIndicatorDelay);
      }), d('imageLoadComplete', (e, i) => {
        t.currItem === i && O(!0);
      }));
    }, b.setIdle = function (t) {
      u = t, z(n, 'ui--idle', t);
    }, b.update = function () {
      S && t.currItem ? (b.updateIndexIndicator(), g.captionEl && (g.addCaptionHTMLFn(t.currItem, o), z(o, 'caption--empty', !t.currItem.title)), w = !0) : w = !1, C || I(), A();
    }, b.updateFullscreen = function (n) {
      n && setTimeout(() => {
        t.setScrollOffset(0, e.getScrollY());
      }, 50), e[`${i.isFullscreen() ? 'add' : 'remove'}Class`](t.template, 'pswp--fs');
    }, b.updateIndexIndicator = function () {
      g.counterEl && (s.innerHTML = t.getCurrentIndex() + 1 + g.indexIndicatorSep + g.getNumItemsFn());
    }, b.onGlobalTap = function (i) {
      const n = (i = i || window.event).target || i.srcElement; if (!v) {
        if (i.detail && i.detail.pointerType === 'mouse') {
          if (M(n)) {
            return void t.close();
          } e.hasClass(n, 'pswp__img') && (t.getZoomLevel() === 1 && t.getZoomLevel() <= t.currItem.fitRatio ? g.clickToCloseNonZoomable && t.close() : t.toggleDesktopZoom(i.detail.releasePoint));
        } else if (g.tapToToggleControls && (S ? b.hideControls() : b.showControls()), g.tapToClose && (e.hasClass(n, 'pswp__img') || M(n))) {
          return void t.close();
        }
      }
    }, b.onMouseOver = function (t) {
      const e = (t = t || window.event).target || t.srcElement; z(n, 'ui--over-close', M(e));
    }, b.hideControls = function () {
      e.addClass(n, 'pswp__ui--hidden'), S = !1;
    }, b.showControls = function () {
      S = !0, w || b.update(), e.removeClass(n, 'pswp__ui--hidden');
    }, b.supportsFullscreen = function () {
      const t = document; return !!(t.exitFullscreen || t.mozCancelFullScreen || t.webkitExitFullscreen || t.msExitFullscreen);
    }, b.getFullscreenAPI = function () {
      let e; const i = document.documentElement; const n = 'fullscreenchange'; return i.requestFullscreen ? e = { enterK: 'requestFullscreen', exitK: 'exitFullscreen', elementK: 'fullscreenElement', eventK: n } : i.mozRequestFullScreen ? e = { enterK: 'mozRequestFullScreen', exitK: 'mozCancelFullScreen', elementK: 'mozFullScreenElement', eventK: `moz${n}` } : i.webkitRequestFullscreen ? e = { enterK: 'webkitRequestFullscreen', exitK: 'webkitExitFullscreen', elementK: 'webkitFullscreenElement', eventK: `webkit${n}` } : i.msRequestFullscreen && (e = { enterK: 'msRequestFullscreen', exitK: 'msExitFullscreen', elementK: 'msFullscreenElement', eventK: 'MSFullscreenChange' }), e && (e.enter = function () {
        return c = g.closeOnScroll, g.closeOnScroll = !1, this.enterK !== 'webkitRequestFullscreen' ? t.template[this.enterK]() : void t.template[this.enterK](Element.ALLOW_KEYBOARD_INPUT);
      }, e.exit = function () {
        return g.closeOnScroll = c, document[this.exitK]();
      }, e.isFullscreen = function () {
        return document[this.elementK];
      }), e;
    };
  };
})),
/*!
 * noUiSlider v15.2.0
 * Lightweight JavaScript range slider library with full multi-touch support.
 * MIT license
 */
(function (t, e) {
  typeof exports == 'object' && typeof module != 'undefined' ? e(exports) : typeof define == 'function' && define.amd ? define(['exports'], e) : e((t = typeof globalThis != 'undefined' ? globalThis : t || self).noUiSlider = {});
}(this, (t) => {
  'use strict'; let e, i; function n(t) {
    return typeof t == 'object' && typeof t.to == 'function';
  } function o(t) {
    t.parentElement.removeChild(t);
  } function r(t) {
    return t != null;
  } function s(t) {
    t.preventDefault();
  } function a(t) {
    return typeof t == 'number' && !isNaN(t) && isFinite(t);
  } function l(t, e, i) {
    i > 0 && (h(t, e), setTimeout(() => {
      p(t, e);
    }, i));
  } function c(t) {
    return Math.max(Math.min(t, 100), 0);
  } function u(t) {
    return Array.isArray(t) ? t : [t];
  } function d(t) {
    const e = (t = String(t)).split('.'); return e.length > 1 ? e[1].length : 0;
  } function h(t, e) {
    t.classList && !/\s/.test(e) ? t.classList.add(e) : t.className += ` ${e}`;
  } function p(t, e) {
    t.classList && !/\s/.test(e) ? t.classList.remove(e) : t.className = t.className.replace(new RegExp(`(^|\\b)${e.split(' ').join('|')}(\\b|$)`, 'gi'), ' ');
  } function f(t) {
    const e = void 0 !== window.pageXOffset; const i = (t.compatMode || '') === 'CSS1Compat'; return { x: e ? window.pageXOffset : i ? t.documentElement.scrollLeft : t.body.scrollLeft, y: e ? window.pageYOffset : i ? t.documentElement.scrollTop : t.body.scrollTop };
  } function m(t, e) {
    return 100 / (e - t);
  } function g(t, e, i) {
    return 100 * e / (t[i + 1] - t[i]);
  } function v(t, e) {
    for (var i = 1; t >= e[i];) {
      i += 1;
    } return i;
  } function y(t, e, i) {
    if (i >= t.slice(-1)[0]) {
      return 100;
    } const n = v(i, t); const o = t[n - 1]; const r = t[n]; const s = e[n - 1]; const a = e[n]; return s + (function (t, e) {
      return g(t, t[0] < 0 ? e + Math.abs(t[0]) : e - t[0], 0);
    }([o, r], i)) / m(s, a);
  } function x(t, e, i, n) {
    if (n === 100) {
      return n;
    } const o = v(n, t); const r = t[o - 1]; const s = t[o]; return i
      ? n - r > (s - r) / 2 ? s : r
      : e[o - 1]
        ? t[o - 1] + (function (t, e) {
          return Math.round(t / e) * e;
        }(n - t[o - 1], e[o - 1]))
        : n;
  }t.PipsMode = void 0, (e = t.PipsMode || (t.PipsMode = {})).Range = 'range', e.Steps = 'steps', e.Positions = 'positions', e.Count = 'count', e.Values = 'values', t.PipsType = void 0, (i = t.PipsType || (t.PipsType = {}))[i.None = -1] = 'None', i[i.NoValue = 0] = 'NoValue', i[i.LargeValue = 1] = 'LargeValue', i[i.SmallValue = 2] = 'SmallValue'; const b = (function () {
    function t(t, e, i) {
      let n; this.xPct = [], this.xVal = [], this.xSteps = [], this.xNumSteps = [], this.xHighestCompleteStep = [], this.xSteps = [i || !1], this.xNumSteps = [!1], this.snap = e; const o = []; for (Object.keys(t).forEach((e) => {
        o.push([u(t[e]), e]);
      }), o.sort((t, e) => {
        return t[0][0] - e[0][0];
      }), n = 0; n < o.length; n++) {
        this.handleEntryPoint(o[n][1], o[n][0]);
      } for (this.xNumSteps = this.xSteps.slice(0), n = 0; n < this.xNumSteps.length; n++) {
        this.handleStepPoint(n, this.xNumSteps[n]);
      }
    } return t.prototype.getDistance = function (t) {
      let e; const i = []; for (e = 0; e < this.xNumSteps.length - 1; e++) {
        const n = this.xNumSteps[e]; if (n && t / n % 1 != 0) {
          throw new Error(`noUiSlider: 'limit', 'margin' and 'padding' of ${this.xPct[e]}% range must be divisible by step.`);
        } i[e] = g(this.xVal, t, e);
      } return i;
    }, t.prototype.getAbsoluteDistance = function (t, e, i) {
      let n; let o = 0; if (t < this.xPct[this.xPct.length - 1]) {
        for (;t > this.xPct[o + 1];) {
          o++;
        }
      } else {
        t === this.xPct[this.xPct.length - 1] && (o = this.xPct.length - 2);
      }i || t !== this.xPct[o + 1] || o++, e === null && (e = []); let r = 1; let s = e[o]; let a = 0; let l = 0; let c = 0; let u = 0; for (n = i ? (t - this.xPct[o]) / (this.xPct[o + 1] - this.xPct[o]) : (this.xPct[o + 1] - t) / (this.xPct[o + 1] - this.xPct[o]); s > 0;) {
        a = this.xPct[o + 1 + u] - this.xPct[o + u], e[o + u] * r + 100 - 100 * n > 100 ? (l = a * n, r = (s - 100 * n) / e[o + u], n = 1) : (l = e[o + u] * a / 100 * r, r = 0), i ? (c -= l, this.xPct.length + u >= 1 && u--) : (c += l, this.xPct.length - u >= 1 && u++), s = e[o + u] * r;
      } return t + c;
    }, t.prototype.toStepping = function (t) {
      return t = y(this.xVal, this.xPct, t);
    }, t.prototype.fromStepping = function (t) {
      return (function (t, e, i) {
        if (i >= 100) {
          return t.slice(-1)[0];
        } const n = v(i, e); const o = t[n - 1]; const r = t[n]; const s = e[n - 1]; return (function (t, e) {
          return e * (t[1] - t[0]) / 100 + t[0];
        }([o, r], (i - s) * m(s, e[n])));
      }(this.xVal, this.xPct, t));
    }, t.prototype.getStep = function (t) {
      return t = x(this.xPct, this.xSteps, this.snap, t);
    }, t.prototype.getDefaultStep = function (t, e, i) {
      let n = v(t, this.xPct); return (t === 100 || e && t === this.xPct[n - 1]) && (n = Math.max(n - 1, 1)), (this.xVal[n] - this.xVal[n - 1]) / i;
    }, t.prototype.getNearbySteps = function (t) {
      const e = v(t, this.xPct); return { stepBefore: { startValue: this.xVal[e - 2], step: this.xNumSteps[e - 2], highestStep: this.xHighestCompleteStep[e - 2] }, thisStep: { startValue: this.xVal[e - 1], step: this.xNumSteps[e - 1], highestStep: this.xHighestCompleteStep[e - 1] }, stepAfter: { startValue: this.xVal[e], step: this.xNumSteps[e], highestStep: this.xHighestCompleteStep[e] } };
    }, t.prototype.countStepDecimals = function () {
      const t = this.xNumSteps.map(d); return Math.max.apply(null, t);
    }, t.prototype.convert = function (t) {
      return this.getStep(this.toStepping(t));
    }, t.prototype.handleEntryPoint = function (t, e) {
      let i; if (!a(i = t === 'min' ? 0 : t === 'max' ? 100 : Number.parseFloat(t)) || !a(e[0])) {
        throw new Error('noUiSlider: \'range\' value isn\'t numeric.');
      } this.xPct.push(i), this.xVal.push(e[0]); const n = Number(e[1]); i ? this.xSteps.push(!isNaN(n) && n) : isNaN(n) || (this.xSteps[0] = n), this.xHighestCompleteStep.push(0);
    }, t.prototype.handleStepPoint = function (t, e) {
      if (e) {
        if (this.xVal[t] !== this.xVal[t + 1]) {
          this.xSteps[t] = g([this.xVal[t], this.xVal[t + 1]], e, 0) / m(this.xPct[t], this.xPct[t + 1]); const i = (this.xVal[t + 1] - this.xVal[t]) / this.xNumSteps[t]; const n = Math.ceil(Number(i.toFixed(3)) - 1); const o = this.xVal[t] + this.xNumSteps[t] * n; this.xHighestCompleteStep[t] = o;
        } else {
          this.xSteps[t] = this.xHighestCompleteStep[t] = this.xVal[t];
        }
      }
    }, t;
  }()); const w = { to(t) {
    return void 0 === t ? '' : t.toFixed(2);
  }, from: Number }; const S = { target: 'target', base: 'base', origin: 'origin', handle: 'handle', handleLower: 'handle-lower', handleUpper: 'handle-upper', touchArea: 'touch-area', horizontal: 'horizontal', vertical: 'vertical', background: 'background', connect: 'connect', connects: 'connects', ltr: 'ltr', rtl: 'rtl', textDirectionLtr: 'txt-dir-ltr', textDirectionRtl: 'txt-dir-rtl', draggable: 'draggable', drag: 'state-drag', tap: 'state-tap', active: 'active', tooltip: 'tooltip', pips: 'pips', pipsHorizontal: 'pips-horizontal', pipsVertical: 'pips-vertical', marker: 'marker', markerHorizontal: 'marker-horizontal', markerVertical: 'marker-vertical', markerNormal: 'marker-normal', markerLarge: 'marker-large', markerSub: 'marker-sub', value: 'value', valueHorizontal: 'value-horizontal', valueVertical: 'value-vertical', valueNormal: 'value-normal', valueLarge: 'value-large', valueSub: 'value-sub' }; const C = '.__tooltips'; const E = '.__aria'; function D(t, e) {
    if (!a(e)) {
      throw new Error('noUiSlider: \'step\' is not numeric.');
    } t.singleStep = e;
  } function P(t, e) {
    if (!a(e)) {
      throw new Error('noUiSlider: \'keyboardPageMultiplier\' is not numeric.');
    } t.keyboardPageMultiplier = e;
  } function z(t, e) {
    if (!a(e)) {
      throw new Error('noUiSlider: \'keyboardDefaultStep\' is not numeric.');
    } t.keyboardDefaultStep = e;
  } function A(t, e) {
    if (typeof e != 'object' || Array.isArray(e)) {
      throw new TypeError('noUiSlider: \'range\' is not an object.');
    } if (void 0 === e.min || void 0 === e.max) {
      throw new Error('noUiSlider: Missing \'min\' or \'max\' in \'range\'.');
    } if (e.min === e.max) {
      throw new Error('noUiSlider: \'range\' \'min\' and \'max\' cannot be equal.');
    } t.spectrum = new b(e, t.snap || !1, t.singleStep);
  } function _(t, e) {
    if (e = u(e), !Array.isArray(e) || !e.length) {
      throw new Error('noUiSlider: \'start\' option is incorrect.');
    } t.handles = e.length, t.start = e;
  } function I(t, e) {
    if (typeof e != 'boolean') {
      throw new TypeError('noUiSlider: \'snap\' option must be a boolean.');
    } t.snap = e;
  } function k(t, e) {
    if (typeof e != 'boolean') {
      throw new TypeError('noUiSlider: \'animate\' option must be a boolean.');
    } t.animate = e;
  } function T(t, e) {
    if (typeof e != 'number') {
      throw new TypeError('noUiSlider: \'animationDuration\' option must be a number.');
    } t.animationDuration = e;
  } function M(t, e) {
    let i; let n = [!1]; if (e === 'lower' ? e = [!0, !1] : e === 'upper' && (e = [!1, !0]), !0 === e || !1 === e) {
      for (i = 1; i < t.handles; i++) {
        n.push(e);
      }n.push(!1);
    } else {
      if (!Array.isArray(e) || !e.length || e.length !== t.handles + 1) {
        throw new Error('noUiSlider: \'connect\' option doesn\'t match handle count.');
      } n = e;
    }t.connect = n;
  } function L(t, e) {
    switch (e) {
      case 'horizontal':t.ort = 0; break; case 'vertical':t.ort = 1; break; default:throw new Error('noUiSlider: \'orientation\' option is invalid.');
    }
  } function F(t, e) {
    if (!a(e)) {
      throw new Error('noUiSlider: \'margin\' option must be numeric.');
    } e !== 0 && (t.margin = t.spectrum.getDistance(e));
  } function N(t, e) {
    if (!a(e)) {
      throw new Error('noUiSlider: \'limit\' option must be numeric.');
    } if (t.limit = t.spectrum.getDistance(e), !t.limit || t.handles < 2) {
      throw new Error('noUiSlider: \'limit\' option is only supported on linear sliders with 2 or more handles.');
    }
  } function O(t, e) {
    let i; if (!a(e) && !Array.isArray(e)) {
      throw new Error('noUiSlider: \'padding\' option must be numeric or array of exactly 2 numbers.');
    } if (Array.isArray(e) && e.length !== 2 && !a(e[0]) && !a(e[1])) {
      throw new Error('noUiSlider: \'padding\' option must be numeric or array of exactly 2 numbers.');
    } if (e !== 0) {
      for (Array.isArray(e) || (e = [e, e]), t.padding = [t.spectrum.getDistance(e[0]), t.spectrum.getDistance(e[1])], i = 0; i < t.spectrum.xNumSteps.length - 1; i++) {
        if (t.padding[0][i] < 0 || t.padding[1][i] < 0) {
          throw new Error('noUiSlider: \'padding\' option must be a positive number(s).');
        }
      } const n = e[0] + e[1]; const o = t.spectrum.xVal[0]; if (n / (t.spectrum.xVal[t.spectrum.xVal.length - 1] - o) > 1) {
        throw new Error('noUiSlider: \'padding\' option must not exceed 100% of the range.');
      }
    }
  } function U(t, e) {
    switch (e) {
      case 'ltr':t.dir = 0; break; case 'rtl':t.dir = 1; break; default:throw new Error('noUiSlider: \'direction\' option was not recognized.');
    }
  } function R(t, e) {
    if (typeof e != 'string') {
      throw new TypeError('noUiSlider: \'behaviour\' must be a string containing options.');
    } const i = e.includes('tap'); const n = e.includes('drag'); const o = e.includes('fixed'); const r = e.includes('snap'); const s = e.includes('hover'); const a = e.includes('unconstrained'); if (o) {
      if (t.handles !== 2) {
        throw new Error('noUiSlider: \'fixed\' behaviour must be used with 2 handles');
      } F(t, t.start[1] - t.start[0]);
    } if (a && (t.margin || t.limit)) {
      throw new Error('noUiSlider: \'unconstrained\' behaviour cannot be used with margin or limit');
    } t.events = { tap: i || r, drag: n, fixed: o, snap: r, hover: s, unconstrained: a };
  } function W(t, e) {
    if (!1 !== e) {
      if (!0 === e || n(e)) {
        t.tooltips = []; for (let i = 0; i < t.handles; i++) {
          t.tooltips.push(e);
        }
      } else {
        if ((e = u(e)).length !== t.handles) {
          throw new Error('noUiSlider: must pass a formatter for all handles.');
        } e.forEach((t) => {
          if (typeof t != 'boolean' && !n(t)) {
            throw new Error('noUiSlider: \'tooltips\' must be passed a formatter or \'false\'.');
          }
        }), t.tooltips = e;
      }
    }
  } function V(t, e) {
    if (!n(e)) {
      throw new Error('noUiSlider: \'ariaFormat\' requires \'to\' method.');
    } t.ariaFormat = e;
  } function H(t, e) {
    if (!(function (t) {
      return n(t) && typeof t.from == 'function';
    }(e))) {
      throw new Error('noUiSlider: \'format\' requires \'to\' and \'from\' methods.');
    } t.format = e;
  } function B(t, e) {
    if (typeof e != 'boolean') {
      throw new TypeError('noUiSlider: \'keyboardSupport\' option must be a boolean.');
    } t.keyboardSupport = e;
  } function j(t, e) {
    t.documentElement = e;
  } function q(t, e) {
    if (typeof e != 'string' && !1 !== e) {
      throw new Error('noUiSlider: \'cssPrefix\' must be a string or `false`.');
    } t.cssPrefix = e;
  } function Z(t, e) {
    if (typeof e != 'object') {
      throw new TypeError('noUiSlider: \'cssClasses\' must be an object.');
    } typeof t.cssPrefix == 'string'
      ? (t.cssClasses = {}, Object.keys(e).forEach((i) => {
          t.cssClasses[i] = t.cssPrefix + e[i];
        }))
      : t.cssClasses = e;
  } function X(t) {
    const e = { margin: null, limit: null, padding: null, animate: !0, animationDuration: 300, ariaFormat: w, format: w }; const i = { step: { r: !1, t: D }, keyboardPageMultiplier: { r: !1, t: P }, keyboardDefaultStep: { r: !1, t: z }, start: { r: !0, t: _ }, connect: { r: !0, t: M }, direction: { r: !0, t: U }, snap: { r: !1, t: I }, animate: { r: !1, t: k }, animationDuration: { r: !1, t: T }, range: { r: !0, t: A }, orientation: { r: !1, t: L }, margin: { r: !1, t: F }, limit: { r: !1, t: N }, padding: { r: !1, t: O }, behaviour: { r: !0, t: R }, ariaFormat: { r: !1, t: V }, format: { r: !1, t: H }, tooltips: { r: !1, t: W }, keyboardSupport: { r: !0, t: B }, documentElement: { r: !1, t: j }, cssPrefix: { r: !0, t: q }, cssClasses: { r: !0, t: Z } }; const n = { connect: !1, direction: 'ltr', behaviour: 'tap', orientation: 'horizontal', keyboardSupport: !0, cssPrefix: 'noUi-', cssClasses: S, keyboardPageMultiplier: 5, keyboardDefaultStep: 10 }; t.format && !t.ariaFormat && (t.ariaFormat = t.format), Object.keys(i).forEach((o) => {
      if (r(t[o]) || void 0 !== n[o]) {
        i[o].t(e, r(t[o]) ? t[o] : n[o]);
      } else if (i[o].r) {
        throw new Error(`noUiSlider: '${o}' is required.`);
      }
    }), e.pips = t.pips; const o = document.createElement('div'); const s = void 0 !== o.style.msTransform; const a = void 0 !== o.style.transform; e.transformRule = a ? 'transform' : s ? 'msTransform' : 'webkitTransform'; return e.style = [['left', 'top'], ['right', 'bottom']][e.dir][e.ort], e;
  } function G(e, i, n) {
    let a; let d; let m; let g; let v; let y; let x; const b = window.navigator.pointerEnabled ? { start: 'pointerdown', move: 'pointermove', end: 'pointerup' } : window.navigator.msPointerEnabled ? { start: 'MSPointerDown', move: 'MSPointerMove', end: 'MSPointerUp' } : { start: 'mousedown touchstart', move: 'mousemove touchmove', end: 'mouseup touchend' }; const w = window.CSS && CSS.supports && CSS.supports('touch-action', 'none') && (function () {
      let t = !1; try {
        const e = Object.defineProperty({}, 'passive', { get() {
          t = !0;
        } }); window.addEventListener('test', null, e);
      } catch (t) {} return t;
    }()); const S = e; let D = i.spectrum; const P = []; let z = []; const A = []; let _ = 0; const I = {}; const k = e.ownerDocument; const T = i.documentElement || k.documentElement; const M = k.body; const L = k.dir === 'rtl' || i.ort === 1 ? 0 : 100; function F(t, e) {
      const i = k.createElement('div'); return e && h(i, e), t.appendChild(i), i;
    } function N(t, e) {
      const n = F(t, i.cssClasses.origin); const o = F(n, i.cssClasses.handle); return F(o, i.cssClasses.touchArea), o.setAttribute('data-handle', String(e)), i.keyboardSupport && (o.setAttribute('tabindex', '0'), o.addEventListener('keydown', (t) => {
        return (function (t, e) {
          if (R() || W(e)) {
            return !1;
          } const n = ['Left', 'Right']; const o = ['Down', 'Up']; const r = ['PageDown', 'PageUp']; const s = ['Home', 'End']; i.dir && !i.ort ? n.reverse() : i.ort && !i.dir && (o.reverse(), r.reverse()); let a; const l = t.key.replace('Arrow', ''); const c = l === r[0]; const u = l === r[1]; const d = l === o[0] || l === n[0] || c; const h = l === o[1] || l === n[1] || u; const p = l === s[0]; const f = l === s[1]; if (!(d || h || p || f)) {
            return !0;
          } if (t.preventDefault(), h || d) {
            const m = i.keyboardPageMultiplier; const g = d ? 0 : 1; let v = vt(e)[g]; if (v === null) {
              return !1;
            } !1 === v && (v = D.getDefaultStep(z[e], d, i.keyboardDefaultStep)), (u || c) && (v *= m), v = Math.max(v, 1e-7), v *= d ? -1 : 1, a = P[e] + v;
          } else {
            a = f ? i.spectrum.xVal[i.spectrum.xVal.length - 1] : i.spectrum.xVal[0];
          } return ht(e, D.toStepping(a), !0, !0), st('slide', e), st('update', e), st('change', e), st('set', e), !1;
        }(t, e));
      })), o.setAttribute('role', 'slider'), o.setAttribute('aria-orientation', i.ort ? 'vertical' : 'horizontal'), e === 0 ? h(o, i.cssClasses.handleLower) : e === i.handles - 1 && h(o, i.cssClasses.handleUpper), n;
    } function O(t, e) {
      return !!e && F(t, i.cssClasses.connect);
    } function U(t, e) {
      return !(!i.tooltips || !i.tooltips[e]) && F(t.firstChild, i.cssClasses.tooltip);
    } function R() {
      return S.hasAttribute('disabled');
    } function W(t) {
      return d[t].hasAttribute('disabled');
    } function V() {
      v && (rt(`update${C}`), v.forEach((t) => {
        t && o(t);
      }), v = null);
    } function H() {
      V(), v = d.map(U), ot(`update${C}`, (t, e, n) => {
        if (v && i.tooltips && !1 !== v[e]) {
          let o = t[e]; !0 !== i.tooltips[e] && (o = i.tooltips[e].to(n[e])), v[e].innerHTML = o;
        }
      });
    } function B(t, e) {
      return t.map((t) => {
        return D.fromStepping(e ? D.getStep(t) : t);
      });
    } function j(e) {
      let i; let n = (function (e) {
        if (e.mode === t.PipsMode.Range || e.mode === t.PipsMode.Steps) {
          return D.xVal;
        } if (e.mode === t.PipsMode.Count) {
          if (e.values < 2) {
            throw new Error('noUiSlider: \'values\' (>= 2) required for mode \'count\'.');
          } for (var i = e.values - 1, n = 100 / i, o = []; i--;) {
            o[i] = i * n;
          } return o.push(100), B(o, e.stepped);
        } return e.mode === t.PipsMode.Positions
          ? B(e.values, e.stepped)
          : e.mode === t.PipsMode.Values
            ? e.stepped
              ? e.values.map((t) => {
                return D.fromStepping(D.getStep(D.toStepping(t)));
              })
              : e.values
            : [];
      }(e)); const o = {}; const r = D.xVal[0]; const s = D.xVal[D.xVal.length - 1]; let a = !1; let l = !1; let c = 0; return i = n.slice().sort((t, e) => {
        return t - e;
      }), (n = i.filter(function (t) {
        return !this[t] && (this[t] = !0);
      }, {}))[0] !== r && (n.unshift(r), a = !0), n[n.length - 1] !== s && (n.push(s), l = !0), n.forEach((i, r) => {
        let s; let u; let d; let h; let p; let f; let m; let g; let v; let y; const x = i; let b = n[r + 1]; const w = e.mode === t.PipsMode.Steps; for (w && (s = D.xNumSteps[r]), s || (s = b - x), void 0 === b && (b = x), s = Math.max(s, 1e-7), u = x; u <= b; u = Number((u + s).toFixed(7))) {
          for (g = (p = (h = D.toStepping(u)) - c) / (e.density || 1), y = p / (v = Math.round(g)), d = 1; d <= v; d += 1) {
            o[(f = c + d * y).toFixed(5)] = [D.fromStepping(f), 0];
          }m = n.includes(u) ? t.PipsType.LargeValue : w ? t.PipsType.SmallValue : t.PipsType.NoValue, !r && a && u !== b && (m = 0), u === b && l || (o[h.toFixed(5)] = [u, m]), c = h;
        }
      }), o;
    } function q(e, n, o) {
      let r; let s; const a = k.createElement('div'); const l = ((r = {})[t.PipsType.None] = '', r[t.PipsType.NoValue] = i.cssClasses.valueNormal, r[t.PipsType.LargeValue] = i.cssClasses.valueLarge, r[t.PipsType.SmallValue] = i.cssClasses.valueSub, r); const c = ((s = {})[t.PipsType.None] = '', s[t.PipsType.NoValue] = i.cssClasses.markerNormal, s[t.PipsType.LargeValue] = i.cssClasses.markerLarge, s[t.PipsType.SmallValue] = i.cssClasses.markerSub, s); const u = [i.cssClasses.valueHorizontal, i.cssClasses.valueVertical]; const d = [i.cssClasses.markerHorizontal, i.cssClasses.markerVertical]; function p(t, e) {
        const n = e === i.cssClasses.value; const o = n ? l : c; return `${e} ${(n ? u : d)[i.ort]} ${o[t]}`;
      } return h(a, i.cssClasses.pips), h(a, i.ort === 0 ? i.cssClasses.pipsHorizontal : i.cssClasses.pipsVertical), Object.keys(e).forEach((r) => {
        !(function (e, r, s) {
          if ((s = n ? n(r, s) : s) !== t.PipsType.None) {
            let l = F(a, !1); l.className = p(s, i.cssClasses.marker), l.style[i.style] = `${e}%`, s > t.PipsType.NoValue && ((l = F(a, !1)).className = p(s, i.cssClasses.value), l.setAttribute('data-value', String(r)), l.style[i.style] = `${e}%`, l.innerHTML = String(o.to(r)));
          }
        }(r, e[r][0], e[r][1]));
      }), a;
    } function Z() {
      g && (o(g), g = null);
    } function G(t) {
      Z(); const e = j(t); const i = t.filter; const n = t.format || { to(t) {
        return String(Math.round(t));
      } }; return g = S.appendChild(q(e, i, n));
    } function Y() {
      const t = a.getBoundingClientRect(); const e = `offset${['Width', 'Height'][i.ort]}`; return i.ort === 0 ? t.width || a[e] : t.height || a[e];
    } function K(t, e, n, o) {
      const r = function (r) {
        let s; let a; const l = (function (t, e, i) {
          const n = t.type.indexOf('touch') === 0; const o = t.type.indexOf('mouse') === 0; let r = t.type.indexOf('pointer') === 0; let s = 0; let a = 0; t.type.indexOf('MSPointer') === 0 && (r = !0); if (t.type === 'mousedown' && !t.buttons && !t.touches) {
            return !1;
          } if (n) {
            const l = function (e) {
              const n = e.target; return n === i || i.contains(n) || t.composed && t.composedPath().shift() === i;
            }; if (t.type === 'touchstart') {
              const c = Array.prototype.filter.call(t.touches, l); if (c.length > 1) {
                return !1;
              } s = c[0].pageX, a = c[0].pageY;
            } else {
              const u = Array.prototype.find.call(t.changedTouches, l); if (!u) {
                return !1;
              } s = u.pageX, a = u.pageY;
            }
          }e = e || f(k), (o || r) && (s = t.clientX + e.x, a = t.clientY + e.y); return t.pageOffset = e, t.points = [s, a], t.cursor = o || r, t;
        }(r, o.pageOffset, o.target || e)); return !!l && (!(R() && !o.doNotReject) && (s = S, a = i.cssClasses.tap, !((s.classList ? s.classList.contains(a) : new RegExp(`\\b${a}\\b`).test(s.className)) && !o.doNotReject) && (!(t === b.start && void 0 !== l.buttons && l.buttons > 1) && ((!o.hover || !l.buttons) && (w || l.preventDefault(), l.calcPoint = l.points[i.ort], void n(l, o))))));
      }; const s = []; return t.split(' ').forEach((t) => {
        e.addEventListener(t, r, !!w && { passive: !0 }), s.push([t, r]);
      }), s;
    } function $(t) {
      let e; let n; let o; let r; let s; let l; let u = 100 * (t - (e = a, n = i.ort, o = e.getBoundingClientRect(), r = e.ownerDocument, s = r.documentElement, l = f(r), /webkit.*Chrome.*Mobile/i.test(navigator.userAgent) && (l.x = 0), n ? o.top + l.y - s.clientTop : o.left + l.x - s.clientLeft)) / Y(); return u = c(u), i.dir ? 100 - u : u;
    } function J(t, e) {
      t.type === 'mouseout' && t.target.nodeName === 'HTML' && t.relatedTarget === null && tt(t, e);
    } function Q(t, e) {
      if (!navigator.appVersion.includes('MSIE 9') && t.buttons === 0 && e.buttonsProperty !== 0) {
        return tt(t, e);
      } const n = (i.dir ? -1 : 1) * (t.calcPoint - e.startCalcPoint); ct(n > 0, 100 * n / e.baseSize, e.locations, e.handleNumbers, e.connect);
    } function tt(t, e) {
      e.handle && (p(e.handle, i.cssClasses.active), _ -= 1), e.listeners.forEach((t) => {
        T.removeEventListener(t[0], t[1]);
      }), _ === 0 && (p(S, i.cssClasses.drag), dt(), t.cursor && (M.style.cursor = '', M.removeEventListener('selectstart', s))), e.handleNumbers.forEach((t) => {
        st('change', t), st('set', t), st('end', t);
      });
    } function et(t, e) {
      if (!e.handleNumbers.some(W)) {
        let n; if (e.handleNumbers.length === 1) {
          n = d[e.handleNumbers[0]].children[0], _ += 1, h(n, i.cssClasses.active);
        }t.stopPropagation(); const o = []; const r = K(b.move, T, Q, { target: t.target, handle: n, connect: e.connect, listeners: o, startCalcPoint: t.calcPoint, baseSize: Y(), pageOffset: t.pageOffset, handleNumbers: e.handleNumbers, buttonsProperty: t.buttons, locations: z.slice() }); const a = K(b.end, T, tt, { target: t.target, handle: n, listeners: o, doNotReject: !0, handleNumbers: e.handleNumbers }); const l = K('mouseout', T, J, { target: t.target, handle: n, listeners: o, doNotReject: !0, handleNumbers: e.handleNumbers }); o.push.apply(o, r.concat(a, l)), t.cursor && (M.style.cursor = getComputedStyle(t.target).cursor, d.length > 1 && h(S, i.cssClasses.drag), M.addEventListener('selectstart', s, !1)), e.handleNumbers.forEach((t) => {
          st('start', t);
        });
      }
    } function it(t) {
      t.stopPropagation(); const e = $(t.calcPoint); const n = (function (t) {
        let e = 100; let i = !1; return d.forEach((n, o) => {
          if (!W(o)) {
            const r = z[o]; const s = Math.abs(r - t); (s < e || s <= e && t > r || s === 100 && e === 100) && (i = o, e = s);
          }
        }), i;
      }(e)); !1 !== n && (i.events.snap || l(S, i.cssClasses.tap, i.animationDuration), ht(n, e, !0, !0), dt(), st('slide', n, !0), st('update', n, !0), st('change', n, !0), st('set', n, !0), i.events.snap && et(t, { handleNumbers: [n] }));
    } function nt(t) {
      const e = $(t.calcPoint); const i = D.getStep(e); const n = D.fromStepping(i); Object.keys(I).forEach((t) => {
        t.split('.')[0] === 'hover' && I[t].forEach((t) => {
          t.call(yt, n);
        });
      });
    } function ot(t, e) {
      I[t] = I[t] || [], I[t].push(e), t.split('.')[0] === 'update' && d.forEach((t, e) => {
        st('update', e);
      });
    } function rt(t) {
      const e = t && t.split('.')[0]; const i = e ? t.substring(e.length) : t; Object.keys(I).forEach((t) => {
        const n = t.split('.')[0]; const o = t.substring(n.length); e && e !== n || i && i !== o || (function (t) {
          return t === E || t === C;
        }(o)) && i !== o || delete I[t];
      });
    } function st(t, e, n) {
      Object.keys(I).forEach((o) => {
        const r = o.split('.')[0]; t === r && I[o].forEach((t) => {
          t.call(yt, P.map(i.format.to), e, P.slice(), n || !1, z.slice(), yt);
        });
      });
    } function at(t, e, n, o, r, s) {
      let a; return d.length > 1 && !i.events.unconstrained && (o && e > 0 && (a = D.getAbsoluteDistance(t[e - 1], i.margin, !1), n = Math.max(n, a)), r && e < d.length - 1 && (a = D.getAbsoluteDistance(t[e + 1], i.margin, !0), n = Math.min(n, a))), d.length > 1 && i.limit && (o && e > 0 && (a = D.getAbsoluteDistance(t[e - 1], i.limit, !1), n = Math.min(n, a)), r && e < d.length - 1 && (a = D.getAbsoluteDistance(t[e + 1], i.limit, !0), n = Math.max(n, a))), i.padding && (e === 0 && (a = D.getAbsoluteDistance(0, i.padding[0], !1), n = Math.max(n, a)), e === d.length - 1 && (a = D.getAbsoluteDistance(100, i.padding[1], !0), n = Math.min(n, a))), !((n = c(n = D.getStep(n))) === t[e] && !s) && n;
    } function lt(t, e) {
      const n = i.ort; return `${n ? e : t}, ${n ? t : e}`;
    } function ct(t, e, i, n, o) {
      const r = i.slice(); const s = n[0]; let a = [!t, t]; let l = [t, !t]; n = n.slice(), t && n.reverse(), n.length > 1
        ? n.forEach((t, i) => {
          const n = at(r, t, r[t] + e, a[i], l[i], !1); !1 === n ? e = 0 : (e = n - r[t], r[t] = n);
        })
        : a = l = [!0]; let c = !1; n.forEach((t, n) => {
        c = ht(t, i[t] + e, a[n], l[n]) || c;
      }), c && (n.forEach((t) => {
        st('update', t), st('slide', t);
      }), o != null && st('drag', s));
    } function ut(t, e) {
      return i.dir ? 100 - t - e : t;
    } function dt() {
      A.forEach((t) => {
        const e = z[t] > 50 ? -1 : 1; const i = 3 + (d.length + e * t); d[t].style.zIndex = String(i);
      });
    } function ht(t, e, n, o, r) {
      return r || (e = at(z, t, e, n, o, !1)), !1 !== e && ((function (t, e) {
        z[t] = e, P[t] = D.fromStepping(e); const n = `translate(${lt(`${10 * (ut(e, 0) - L)}%`, '0')})`; d[t].style[i.transformRule] = n, pt(t), pt(t + 1);
      }(t, e)), !0);
    } function pt(t) {
      if (m[t]) {
        let e = 0; let n = 100; t !== 0 && (e = z[t - 1]), t !== m.length - 1 && (n = z[t]); const o = n - e; const r = `translate(${lt(`${ut(e, o)}%`, '0')})`; const s = `scale(${lt(o / 100, '1')})`; m[t].style[i.transformRule] = `${r} ${s}`;
      }
    } function ft(t, e) {
      return t === null || !1 === t || void 0 === t ? z[e] : (typeof t == 'number' && (t = String(t)), !1 !== (t = i.format.from(t)) && (t = D.toStepping(t)), !1 === t || isNaN(t) ? z[e] : t);
    } function mt(t, e, n) {
      const o = u(t); const r = void 0 === z[0]; e = void 0 === e || e, i.animate && !r && l(S, i.cssClasses.tap, i.animationDuration), A.forEach((t) => {
        ht(t, ft(o[t], t), !0, !1, n);
      }); for (let s = A.length === 1 ? 0 : 1; s < A.length; ++s) {
        A.forEach((t) => {
          ht(t, z[t], !0, !0, n);
        });
      }dt(), A.forEach((t) => {
        st('update', t), o[t] !== null && e && st('set', t);
      });
    } function gt(t) {
      if (void 0 === t && (t = !1), t) {
        return P.length === 1 ? P[0] : P.slice(0);
      } const e = P.map(i.format.to); return e.length === 1 ? e[0] : e;
    } function vt(t) {
      const e = z[t]; const n = D.getNearbySteps(e); const o = P[t]; let r = n.thisStep.step; let s = null; if (i.snap) {
        return [o - n.stepBefore.startValue || null, n.stepAfter.startValue - o || null];
      } !1 !== r && o + r > n.stepAfter.startValue && (r = n.stepAfter.startValue - o), s = o > n.thisStep.startValue ? n.thisStep.step : !1 !== n.stepBefore.step && o - n.stepBefore.highestStep, e === 100 ? r = null : e === 0 && (s = null); const a = D.countStepDecimals(); return r !== null && !1 !== r && (r = Number(r.toFixed(a))), s !== null && !1 !== s && (s = Number(s.toFixed(a))), [s, r];
    }h(y = S, i.cssClasses.target), i.dir === 0 ? h(y, i.cssClasses.ltr) : h(y, i.cssClasses.rtl), i.ort === 0 ? h(y, i.cssClasses.horizontal) : h(y, i.cssClasses.vertical), h(y, getComputedStyle(y).direction === 'rtl' ? i.cssClasses.textDirectionRtl : i.cssClasses.textDirectionLtr), a = F(y, i.cssClasses.base), (function (t, e) {
      const n = F(e, i.cssClasses.connects); d = [], (m = []).push(O(n, t[0])); for (let o = 0; o < i.handles; o++) {
        d.push(N(e, o)), A[o] = o, m.push(O(n, t[o + 1]));
      }
    }(i.connect, a)), (x = i.events).fixed || d.forEach((t, e) => {
      K(b.start, t.children[0], et, { handleNumbers: [e] });
    }), x.tap && K(b.start, a, it, {}), x.hover && K(b.move, a, nt, { hover: !0 }), x.drag && m.forEach((t, e) => {
      if (!1 !== t && e !== 0 && e !== m.length - 1) {
        const n = d[e - 1]; const o = d[e]; const r = [t]; h(t, i.cssClasses.draggable), x.fixed && (r.push(n.children[0]), r.push(o.children[0])), r.forEach((i) => {
          K(b.start, i, et, { handles: [n, o], handleNumbers: [e - 1, e], connect: t });
        });
      }
    }), mt(i.start), i.pips && G(i.pips), i.tooltips && H(), rt(`update${E}`), ot(`update${E}`, (t, e, n, o, r) => {
      A.forEach((t) => {
        const e = d[t]; let o = at(z, t, 0, !0, !0, !0); let s = at(z, t, 100, !0, !0, !0); let a = r[t]; const l = String(i.ariaFormat.to(n[t])); o = D.fromStepping(o).toFixed(1), s = D.fromStepping(s).toFixed(1), a = D.fromStepping(a).toFixed(1), e.children[0].setAttribute('aria-valuemin', o), e.children[0].setAttribute('aria-valuemax', s), e.children[0].setAttribute('aria-valuenow', a), e.children[0].setAttribute('aria-valuetext', l);
      });
    }); var yt = { destroy() {
      for (rt(E), rt(C), Object.keys(i.cssClasses).forEach((t) => {
        p(S, i.cssClasses[t]);
      }); S.firstChild;) {
        S.removeChild(S.firstChild);
      } delete S.noUiSlider;
    }, steps() {
      return A.map(vt);
    }, on: ot, off: rt, get: gt, set: mt, setHandle(t, e, i, n) {
      if (!((t = Number(t)) >= 0 && t < A.length)) {
        throw new Error(`noUiSlider: invalid handle number, got: ${t}`);
      } ht(t, ft(e, t), !0, !0, n), st('update', t), i && st('set', t);
    }, reset(t) {
      mt(i.start, t);
    }, __moveHandles(t, e, i) {
      ct(t, e, z, i);
    }, options: n, updateOptions(t, e) {
      const o = gt(); const s = ['margin', 'limit', 'padding', 'range', 'animate', 'snap', 'step', 'format', 'pips', 'tooltips']; s.forEach((e) => {
        void 0 !== t[e] && (n[e] = t[e]);
      }); const a = X(n); s.forEach((e) => {
        void 0 !== t[e] && (i[e] = a[e]);
      }), D = a.spectrum, i.margin = a.margin, i.limit = a.limit, i.padding = a.padding, i.pips ? G(i.pips) : Z(), i.tooltips ? H() : V(), z = [], mt(r(t.start) ? t.start : o, e);
    }, target: S, removePips: Z, removeTooltips: V, getTooltips() {
      return v;
    }, getOrigins() {
      return d;
    }, pips: G }; return yt;
  } function Y(t, e) {
    if (!t || !t.nodeName) {
      throw new Error(`noUiSlider: create requires a single element, got: ${t}`);
    } if (t.noUiSlider) {
      throw new Error('noUiSlider: Slider was already initialized.');
    } const i = G(t, X(e), e); return t.noUiSlider = i, i;
  } const K = { __spectrum: b, cssClasses: S, create: Y }; t.create = Y, t.cssClasses = S, t.default = K, Object.defineProperty(t, '__esModule', { value: !0 });
}));
