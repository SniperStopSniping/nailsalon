/**
 * Copyright (c) 2017-present, Facebook, Inc. All rights reserved.
 *
 * You are hereby granted a non-exclusive, worldwide, royalty-free license to use,
 * copy, modify, and distribute this software in source code or binary form for use
 * in connection with the web services and APIs provided by Facebook.
 *
 * As with any software that integrates with the Facebook platform, your use of
 * this software is subject to the Facebook Platform Policy
 * [http://developers.facebook.com/policy/]. This copyright notice shall be
 * included in all copies or substantial portions of the software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
fbq.version = '2.9.243';
fbq._releaseSegment = 'stable';
fbq.pendingConfigs = ['global_config'];
fbq.__openBridgeRollout = 1.0;
(function (a, b, c, d) {
  const e = { exports: {} }; e.exports; (function () {
    const f = a.fbq; f.execStart = a.performance && a.performance.now && a.performance.now(); if (!(function () {
      const b = a.postMessage || function () {}; if (!f) {
        b({ action: 'FB_LOG', logType: 'Facebook Pixel Error', logMessage: 'Pixel code is not installed correctly on this page' }, '*'); 'error' in console && console.error('Facebook Pixel Error: Pixel code is not installed correctly on this page'); return !1;
      } return !0;
    }())) {
      return;
    } function g(a, b, c) {
      return b = p(b), h(a, m() ? Reflect.construct(b, c || [], p(a).constructor) : b.apply(a, c));
    } function h(a, b) {
      if (b && (J(b) == 'object' || typeof b == 'function')) {
        return b;
      } if (void 0 !== b) {
        throw new TypeError('Derived constructors may only return object or undefined');
      } return i(a);
    } function i(a) {
      if (void 0 === a) {
        throw new ReferenceError('this hasn\'t been initialised - super() hasn\'t been called');
      } return a;
    } function j(a, b) {
      if (typeof b != 'function' && b !== null) {
        throw new TypeError('Super expression must either be null or a function');
      } a.prototype = Object.create(b && b.prototype, { constructor: { value: a, writable: !0, configurable: !0 } }), Object.defineProperty(a, 'prototype', { writable: !1 }), b && o(a, b);
    } function k(a) {
      const b = typeof Map == 'function' ? new Map() : void 0; return k = function (a) {
        if (a === null || !n(a)) {
          return a;
        } if (typeof a != 'function') {
          throw new TypeError('Super expression must either be null or a function');
        } if (void 0 !== b) {
          if (b.has(a)) {
            return b.get(a);
          } b.set(a, c);
        } function c() {
          return l(a, arguments, p(this).constructor);
        } return c.prototype = Object.create(a.prototype, { constructor: { value: c, enumerable: !1, writable: !0, configurable: !0 } }), o(c, a);
      }, k(a);
    } function l(a, b, c) {
      if (m()) {
        return Reflect.construct.apply(null, arguments);
      } const d = [null]; d.push.apply(d, b); const e = new (a.bind.apply(a, d))(); return c && o(e, c.prototype), e;
    } function m() {
      try {
        var a = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], () => {}));
      } catch (a) {} return (m = function () {
        return !!a;
      })();
    } function n(a) {
      try {
        return Function.toString.call(a).includes('[native code]');
      } catch (b) {
        return typeof a == 'function';
      }
    } function o(a, b) {
      return o = Object.setPrototypeOf
        ? Object.setPrototypeOf.bind()
        : function (a, b) {
          return a.__proto__ = b, a;
        }, o(a, b);
    } function p(a) {
      return p = Object.setPrototypeOf
        ? Object.getPrototypeOf.bind()
        : function (a) {
          return a.__proto__ || Object.getPrototypeOf(a);
        }, p(a);
    } function q(a, b) {
      return t(a) || s(a, b) || H(a, b) || r();
    } function r() {
      throw new TypeError('Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.');
    } function s(a, b) {
      let c = a == null ? null : typeof Symbol != 'undefined' && a[typeof Symbol === 'function' ? Symbol.iterator : '@@iterator'] || a['@@iterator']; if (c != null) {
        let d; let e; const f = []; let g = !0; let h = !1; try {
          if (a = (c = c.call(a)).next, b === 0) {
            if (Object(c) !== c) {
              return;
            } g = !1;
          } else {
            for (;!(g = (d = a.call(c)).done) && (f.push(d.value), f.length !== b); g = !0) {
              ;
            }
          }
        } catch (a) {
          h = !0, e = a;
        } finally {
          try {
            if (!g && c.return != null && (d = c.return(), Object(d) !== d)) {
              return;
            }
          } finally {
            if (h) {
              throw e;
            }
          }
        } return f;
      }
    } function t(a) {
      if (Array.isArray(a)) {
        return a;
      }
    } function u(a, b) {
      const c = Object.keys(a); if (Object.getOwnPropertySymbols) {
        let d = Object.getOwnPropertySymbols(a); b && (d = d.filter((b) => {
          return Object.getOwnPropertyDescriptor(a, b).enumerable;
        })), c.push.apply(c, d);
      } return c;
    } function v(a) {
      for (let b = 1; b < arguments.length; b++) {
        var c = arguments[b] != null ? arguments[b] : {}; b % 2
          ? u(Object(c), !0).forEach((b) => {
            z(a, b, c[b]);
          })
          : Object.getOwnPropertyDescriptors
            ? Object.defineProperties(a, Object.getOwnPropertyDescriptors(c))
            : u(Object(c)).forEach((b) => {
              Object.defineProperty(a, b, Object.getOwnPropertyDescriptor(c, b));
            });
      } return a;
    } function w(a, b) {
      if (!(a instanceof b)) {
        throw new TypeError('Cannot call a class as a function');
      }
    } function x(a, b) {
      for (let c = 0; c < b.length; c++) {
        const d = b[c]; d.enumerable = d.enumerable || !1, d.configurable = !0, 'value' in d && (d.writable = !0), Object.defineProperty(a, A(d.key), d);
      }
    } function y(a, b, c) {
      return b && x(a.prototype, b), c && x(a, c), Object.defineProperty(a, 'prototype', { writable: !1 }), a;
    } function z(a, b, c) {
      return (b = A(b)) in a ? Object.defineProperty(a, b, { value: c, enumerable: !0, configurable: !0, writable: !0 }) : a[b] = c, a;
    } function A(a) {
      a = B(a, 'string'); return J(a) == 'symbol' ? a : `${a}`;
    } function B(a, b) {
      if (J(a) != 'object' || !a) {
        return a;
      } let c = a[typeof Symbol === 'function' ? Symbol.toPrimitive : '@@toPrimitive']; if (void 0 !== c) {
        c = c.call(a, b || 'default'); if (J(c) != 'object') {
          return c;
        } throw new TypeError('@@toPrimitive must return a primitive value.');
      } return (b === 'string' ? String : Number)(a);
    } function C(a) {
      return F(a) || E(a) || H(a) || D();
    } function D() {
      throw new TypeError('Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.');
    } function E(a) {
      if (typeof Symbol != 'undefined' && a[typeof Symbol === 'function' ? Symbol.iterator : '@@iterator'] != null || a['@@iterator'] != null) {
        return Array.from(a);
      }
    } function F(a) {
      if (Array.isArray(a)) {
        return I(a);
      }
    } function G(a, b) {
      let c = typeof Symbol != 'undefined' && a[typeof Symbol === 'function' ? Symbol.iterator : '@@iterator'] || a['@@iterator']; if (!c) {
        if (Array.isArray(a) || (c = H(a)) || b && a && typeof a.length == 'number') {
          c && (a = c); let d = 0; b = function () {}; return { s: b, n() {
            return d >= a.length ? { done: !0 } : { done: !1, value: a[d++] };
          }, e(a) {
            throw a;
          }, f: b };
        } throw new TypeError('Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.');
      } let e; let f = !0; let g = !1; return { s() {
        c = c.call(a);
      }, n() {
        const a = c.next(); return f = a.done, a;
      }, e(a) {
        g = !0, e = a;
      }, f() {
        try {
          f || c.return == null || c.return();
        } finally {
          if (g) {
            throw e;
          }
        }
      } };
    } function H(a, b) {
      if (a) {
        if (typeof a == 'string') {
          return I(a, b);
        } let c = {}.toString.call(a).slice(8, -1); return c === 'Object' && a.constructor && (c = a.constructor.name), c === 'Map' || c === 'Set' ? Array.from(a) : c === 'Arguments' || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(c) ? I(a, b) : void 0;
      }
    } function I(a, b) {
      (b == null || b > a.length) && (b = a.length); for (var c = 0, d = Array(b); c < b; c++) {
        d[c] = a[c];
      } return d;
    } function J(a) {
      return J = typeof Symbol == 'function' && typeof (typeof Symbol === 'function' ? Symbol.iterator : '@@iterator') == 'symbol'
        ? function (a) {
          return typeof a;
        }
        : function (a) {
          return a && typeof Symbol == 'function' && a.constructor === Symbol && a !== (typeof Symbol === 'function' ? Symbol.prototype : '@@prototype') ? 'symbol' : typeof a;
        }, J(a);
    }f.__fbeventsModules || (f.__fbeventsModules = {}, f.__fbeventsResolvedModules = {}, f.getFbeventsModules = function (a) {
      f.__fbeventsResolvedModules[a] || (f.__fbeventsResolvedModules[a] = f.__fbeventsModules[a]()); return f.__fbeventsResolvedModules[a];
    }, f.fbIsModuleLoaded = function (a) {
      return !!f.__fbeventsModules[a];
    }, f.ensureModuleRegistered = function (b, a) {
      f.fbIsModuleLoaded(b) || (f.__fbeventsModules[b] = a);
    });
    f.ensureModuleRegistered('generateEventId', () => {
      return (function (f, g, h, i) {
        const j = { exports: {} }; j.exports; (function () {
          'use strict'; function a() {
            let a = new Date().getTime(); const b = 'xxxxxxxsx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (b) => {
              const c = (a + Math.random() * 16) % 16 | 0; a = Math.floor(a / 16); return (b == 'x' ? c : c & 3 | 8).toString(16);
            }); return b;
          } function b(b, c) {
            const d = a(); return `${c != null ? c : 'none'}.${b != null ? b : 'none'}.${d}`;
          }j.exports = b;
        })(); return j.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('handleEventIdOverride', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsLogging'); function b(b, c, d, e) {
            if (b != null && (b.eventID != null || b.event_id != null)) {
              let f = b.eventID; b = b.event_id; f = f != null ? f : b; f !== null && J(f) === 'object' && ('eventID' in f || 'event_id' in f ? f = f.eventID != null ? f.eventID : f.event_id : a.logUserError({ pixelID: e || '', type: 'INVALID_EVENT_ID_FORMAT', eventName: d.get('ev') })); f == null && (c.event_id != null || c.eventID != null) && a.consoleWarn('eventID is being sent in the 3rd parameter, it should be in the 4th parameter.'); d.containsKey('eid') ? f == null || f.length == 0 ? a.logUserError({ pixelID: e || '', type: 'NO_EVENT_ID' }) : d.replaceEntry('eid', f) : d.append('eid', f);
            }
          }k.exports = b;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('normalizeSignalsFBEventsDOBType', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; f.getFbeventsModules('SignalsFBEventsQE'); let a = f.getFbeventsModules('normalizeSignalsFBEventsStringType'); const b = a.normalize; a = f.getFbeventsModules('SignalsFBEventsValidationUtils'); const c = a.looksLikeHashed; const d = a.trim; a = f.getFbeventsModules('SignalsFBEventsLogging'); const e = a.logError; function g(a, b, c) {
            const d = new Date().getFullYear(); if (a < 1800 || a > d + 1) {
              return !1;
            } if (b < 1 || b > 12) {
              return !1;
            } return c < 1 || c > 31 ? !1 : !0;
          } function h(a) {
            return a.replace(/\D/g, ' ');
          } function i(a, b, c) {
            let d = 0; let e = 0; let f = 0; a > 31 ? (d = a, e = b > 12 ? c : b, f = b > 12 ? b : c) : b > 31 ? (d = b, e = c > 12 ? a : c, f = c > 12 ? c : a) : (d = c, e = a > 12 ? b : a, f = a > 12 ? a : b); return g(d, e, f) ? String(d).padStart(4, '0') + String(e).padStart(2, '0') + String(f).padStart(2, '0') : null;
          } function j(a) {
            let b = d(h(a)); b = b.split(' ').filter((a) => {
              return a.length > 0;
            }); if (b.length >= 3) {
              let c = Number.parseInt(b[0]); const e = Number.parseInt(b[1]); const f = Number.parseInt(b[2]); c = i(c, e, f); if (c != null) {
                return c;
              }
            } return b.length === 1 && b[0].length === 8 ? b[0] : a;
          } function l(a) {
            return c(a) ? a : j(a);
          } function m(a, c, d) {
            if (a == null) {
              return null;
            } if (typeof a !== 'string') {
              return a;
            } try {
              return !d ? l(a) : b(a, { lowercase: !0, strip: 'whitespace_only' });
            } catch (a) {
              a.message = '[normalizeDOB]: '.concat(a.message), e(a);
            } return a;
          }k.exports = m;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('normalizeSignalsFBEventsEmailType', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsValidationUtils'); const b = a.looksLikeHashed; const c = a.trim; const d = /^[\w!#$%&'*+/=?^`{|}~\-]+(:?\.[\w!#$%&'*+/=?^`{|}~\-]+)*@(?:[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?$/i; function e(a) {
            return d.test(a);
          } function g(a) {
            let d = null; if (a != null) {
              if (b(a)) {
                d = a;
              } else {
                a = c(a.toLowerCase()); d = e(a) ? a : null;
              }
            } return d;
          }k.exports = g;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('normalizeSignalsFBEventsEnumType', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsShared'); const b = a.unicodeSafeTruncate; a = f.getFbeventsModules('SignalsFBEventsValidationUtils'); const c = a.looksLikeHashed; const d = a.trim; function e(a) {
            const e = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {}; let f = null; const g = e.caseInsensitive; const h = e.lowercase; const i = e.options; const j = e.truncate; const k = e.uppercase; if (a != null && i != null && Array.isArray(i) && i.length) {
              if (typeof a === 'string' && c(a)) {
                f = a;
              } else {
                let l = d(String(a)); h === !0 && (l = l.toLowerCase()); k === !0 && (l = l.toUpperCase()); j != null && j !== 0 && (l = b(l, j)); if (g === !0) {
                  const m = l.toLowerCase(); for (let n = 0; n < i.length; ++n) {
                    if (m === i[n].toLowerCase()) {
                      l = i[n]; break;
                    }
                  }
                }f = i.includes(l) ? l : null;
              }
            } return f;
          }k.exports = e;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('normalizeSignalsFBEventsPhoneNumberType', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsLogging'); const b = a.logError; f.getFbeventsModules('SignalsFBEventsQE'); a = f.getFbeventsModules('SignalsFBEventsValidationUtils'); const c = a.looksLikeHashed; const d = /^0*/; const e = /[\-@#<>'",; ()+a-z]/gi; const g = /(?![0-9\uD800-\uDFFF])[\s\S]|[\uD800-\uDBFF][\uDC00-\uDFFF]/g; function h(a, c, d) {
            if (!d) {
              try {
                return j(a);
              } catch (a) {
                a.message = '[normalizePhoneNumber]: '.concat(a.message), b(a);
              }
            } return i(a);
          } function i(a) {
            let b = null; if (a != null) {
              if (c(a)) {
                b = a;
              } else {
                a = String(a); b = a.replace(e, '').replace(d, '');
              }
            } return b;
          } function j(a) {
            if (a == null) {
              return null;
            } return c(a) ? a : String(a).replace(g, '').replace(d, '');
          }k.exports = h;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('normalizeSignalsFBEventsPostalCodeType', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsValidationUtils'); const b = a.looksLikeHashed; const c = a.trim; function d(a) {
            let d = null; if (a != null && typeof a === 'string') {
              if (b(a)) {
                d = a;
              } else {
                a = c(String(a).toLowerCase().split('-', 1)[0]); a.length >= 2 && (d = a);
              }
            } return d;
          }k.exports = d;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('normalizeSignalsFBEventsStringType', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsUtils'); const b = a.keys; a = f.getFbeventsModules('SignalsFBEventsShared'); const c = a.unicodeSafeTruncate; a = f.getFbeventsModules('SignalsFBEventsValidationUtils'); const d = a.looksLikeHashed; const e = a.strip; f.getFbeventsModules('SignalsFBEventsQE'); a = f.getFbeventsModules('SignalsPixelPIIConstants'); const g = a.STATE_MAPPINGS; const h = a.COUNTRY_MAPPINGS; a = f.getFbeventsModules('SignalsFBEventsLogging'); const i = a.logError; function j(a) {
            const b = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {}; let f = null; if (a != null) {
              if (d(a) && typeof a === 'string') {
                b.rejectHashed !== !0 && (f = a);
              } else {
                let g = String(a); b.strip != null && (g = e(g, b.strip)); b.lowercase === !0 ? g = g.toLowerCase() : b.uppercase === !0 && (g = g.toUpperCase()); b.truncate != null && b.truncate !== 0 && (g = c(g, b.truncate)); b.test != null && b.test !== '' ? f = new RegExp(b.test).test(g) ? g : null : f = g;
              }
            } return f;
          } function l(a) {
            return j(a, { strip: 'whitespace_and_punctuation' });
          } function m(a, c) {
            if (a.length === 2) {
              return a;
            } if (c[a] != null) {
              return c[a];
            } const d = G(b(c)); let e; try {
              for (d.s(); !(e = d.n()).done;) {
                e = e.value; if (a.includes(e)) {
                  e = c[e]; return e;
                }
              }
            } catch (a) {
              d.e(a);
            } finally {
              d.f();
            } return a.toLowerCase();
          } function n(a, b) {
            if (d(a) || typeof a !== 'string') {
              return a;
            } a = a; a = a.toLowerCase().trim(); a = a.replace(/[^a-z]/g, ''); a = m(a, b); switch (a.length) {
              case 0:return null; case 1:return a; default:return a.substring(0, 2);
            }
          } function o(a, b, c) {
            if (a == null) {
              return null;
            } b = a; if (!c) {
              try {
                b = n(b, h);
              } catch (a) {
                a.message = `[NormalizeCountry]: ${a.message}`, i(a);
              }
            } return j(b, { truncate: 2, strip: 'all_non_latin_alpha_numeric', test: '^[a-z]+', lowercase: !0 });
          } function p(a, b, c) {
            if (a == null) {
              return null;
            } b = a; if (!c) {
              try {
                b = n(b, g);
              } catch (a) {
                a.message = `[NormalizeState]: ${a.message}`, i(a);
              }
            } return j(b, { truncate: 2, strip: 'all_non_latin_alpha_numeric', test: '^[a-z]+', lowercase: !0 });
          } function q(a) {
            return j(a, { strip: 'all_non_latin_alpha_numeric', test: '^[a-z]+' });
          }k.exports = { normalize: j, normalizeName: l, normalizeCity: q, normalizeState: p, normalizeCountry: o };
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsConvertNodeToHTMLElement', () => {
      return (function (f, g, h, i) {
        const j = { exports: {} }; j.exports; (function () {
          'use strict'; function a(a) {
            if ((typeof HTMLElement === 'undefined' ? 'undefined' : J(HTMLElement)) === 'object') {
              return a instanceof HTMLElement;
            } else {
              return a !== null && J(a) === 'object' && a.nodeType === Node.ELEMENT_NODE && typeof a.nodeName === 'string';
            }
          } function b(b) {
            return !a(b) ? null : b;
          }j.exports = b;
        })(); return j.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsEventValidation', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsLogging'); const b = a.logUserError; const c = /^[+-]?\d+(\.\d+)?$/; const d = 'number'; const e = 'currency_code'; const g = { AED: 1, ARS: 1, AUD: 1, BOB: 1, BRL: 1, CAD: 1, CHF: 1, CLP: 1, CNY: 1, COP: 1, CRC: 1, CZK: 1, DKK: 1, EUR: 1, GBP: 1, GTQ: 1, HKD: 1, HNL: 1, HUF: 1, IDR: 1, ILS: 1, INR: 1, ISK: 1, JPY: 1, KRW: 1, MOP: 1, MXN: 1, MYR: 1, NIO: 1, NOK: 1, NZD: 1, PEN: 1, PHP: 1, PLN: 1, PYG: 1, QAR: 1, RON: 1, RUB: 1, SAR: 1, SEK: 1, SGD: 1, THB: 1, TRY: 1, TWD: 1, USD: 1, UYU: 1, VEF: 1, VND: 1, ZAR: 1 }; a = { value: { isRequired: !0, type: d }, currency: { isRequired: !0, type: e } }; const h = { AddPaymentInfo: {}, AddToCart: {}, AddToWishlist: {}, CompleteRegistration: {}, Contact: {}, CustomEvent: { validationSchema: { event: { isRequired: !0 } } }, CustomizeProduct: {}, Donate: {}, FindLocation: {}, InitiateCheckout: {}, Lead: {}, PageView: {}, PixelInitialized: {}, Purchase: { validationSchema: a }, Schedule: {}, Search: {}, StartTrial: {}, SubmitApplication: {}, Subscribe: {}, ViewContent: {} }; const i = { 'agent': !0, 'automaticmatchingconfig': !0, 'codeless': !0, 'tracksingleonly': !0, 'cbdata.onetrustid': !0 }; const j = Object.prototype.hasOwnProperty; function l() {
            return { error: null, warnings: [] };
          } function m(a) {
            return { error: a, warnings: [] };
          } function n(a) {
            return { error: null, warnings: a };
          } function o(a) {
            if (a) {
              a = a.toLowerCase(); const b = i[a]; if (b !== !0) {
                return m({ metadata: a, type: 'UNSUPPORTED_METADATA_ARGUMENT' });
              }
            } return l();
          } function p(a) {
            const b = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {}; if (!a) {
              return m({ type: 'NO_EVENT_NAME' });
            } const c = h[a]; return !c ? n([{ eventName: a, type: 'NONSTANDARD_EVENT' }]) : q(a, b, c);
          } function q(a, b, f) {
            f = f.validationSchema; const h = []; for (const i in f) {
              if (j.call(f, i)) {
                let k = f[i]; const l = b[i]; if (k) {
                  if (k.isRequired != null && !j.call(b, i)) {
                    return m({ eventName: a, param: i, type: 'REQUIRED_PARAM_MISSING' });
                  } if (k.type != null && typeof k.type === 'string') {
                    let o = !0; switch (k.type) {
                      case d:k = (typeof l === 'string' || typeof l === 'number') && c.test(''.concat(l)); k && Number(l) < 0 && h.push({ eventName: a || 'null', param: i, type: 'NEGATIVE_EVENT_PARAM' }); o = k; break; case e:o = typeof l === 'string' && !!g[l.toUpperCase()]; break;
                    } if (!o) {
                      return m({ eventName: a, param: i, type: 'INVALID_PARAM' });
                    }
                  }
                }
              }
            } return n(h);
          } function r(a, c) {
            a = p(a, c); a.error && b(a.error); if (a.warnings) {
              for (c = 0; c < a.warnings.length; c++) {
                b(a.warnings[c]);
              }
            } return a;
          }k.exports = { validateEvent: p, validateEventAndLog: r, validateMetadata: o };
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsAddGmailSuffixToEmail', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsValidationUtils'); const b = a.looksLikeHashed; a = f.getFbeventsModules('SignalsFBEventsLogging'); const c = a.logError; a = f.getFbeventsModules('SignalsFBEventsUtils'); a.each; a.keys; a = f.getFbeventsModules('SignalsPixelPIIUtils'); a.isEmail; a.isPhoneNumber; a.getGenderCharacter; f.getFbeventsModules('SignalsFBEventsQE'); function d(a) {
            try {
              if (a == null || J(a) !== 'object') {
                return a;
              } a.em != null && a.em.trim() !== '' && !b(a.em) && typeof a.em === 'string' && !a.em.includes('@') && (a.em = `${a.em}@gmail.com`); a.email != null && a.email.trim() !== '' && !b(a.email) && typeof a.email === 'string' && !a.email.includes('@') && (a.email = `${a.email}@gmail.com`);
            } catch (a) {
              a.message = `[NormalizeAddSuffix]:${a.message}`, c(a);
            } return a;
          }k.exports = d;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsAsyncParamUtils', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; f.getFbeventsModules('SignalsParamList'); const a = f.getFbeventsModules('signalsFBEventsSendEventImpl'); function b(a) {
            a.asyncParamPromisesAllSettled = !0; while (a.eventQueue.length > 0) {
              const b = a.eventQueue.shift(); c(a, b);
            }
          } function c(b, c) {
            let d = C(b.asyncParamFetchers.values()); d = G(d); let e; try {
              for (d.s(); !(e = d.n()).done;) {
                e = e.value; const f = e.callback; f != null && f(e.result, c, b);
              }
            } catch (a) {
              d.e(a);
            } finally {
              d.f();
            }a(c, b);
          } function d(a) {
            const c = C(a.asyncParamFetchers.keys()); Promise.allSettled(C(a.asyncParamFetchers.values()).map((a) => {
              return a.request;
            })).then((d) => {
              a.asyncParamPromisesAllSettled = !0, d.forEach((b, d) => {
                if (b.status === 'fulfilled') {
                  d = c[d]; const e = a.asyncParamFetchers.get(d); e != null && e.result == null && (e.result = b.value, a.asyncParamFetchers.set(d, e));
                }
              }), b(a);
            });
          }k.exports = { flushAsyncParamEventQueue: b, registerAsyncParamAllSettledListener: d, appendAsyncParamsAndSendEvent: c };
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsAutomaticPageViewEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); function b() {
            return [];
          }k.exports = new a(b);
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsBaseEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsUtils'); const b = a.map; const c = a.keys; a = (function () {
            function a(b) {
              w(this, a), z(this, '_regKey', 0), z(this, '_subscriptions', {}), this._coerceArgs = b || null;
            } return y(a, [{ key: 'listen', value(a) {
              const b = this; const c = ''.concat(this._regKey++); this._subscriptions[c] = a; return function () {
                delete b._subscriptions[c];
              };
            } }, { key: 'listenOnce', value(a) {
              let b = null; const c = function () {
                b && b(); b = null; return a.apply(void 0, arguments);
              }; b = this.listen(c); return b;
            } }, { key: 'trigger', value() {
              const a = this; for (var d = arguments.length, e = new Array(d), f = 0; f < d; f++) {
                e[f] = arguments[f];
              } return b(c(this._subscriptions), (b) => {
                if (b in a._subscriptions && a._subscriptions[b] != null) {
                  let c; return (c = a._subscriptions)[b].apply(c, e);
                } else {
                  return null;
                }
              });
            } }, { key: 'triggerWeakly', value() {
              const a = this._coerceArgs != null ? this._coerceArgs.apply(this, arguments) : null; return a == null ? [] : this.trigger.apply(this, C(a));
            } }]);
          }()); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsBotBlockingConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); a = a.Typed; a = a.objectWithFields({ rules: a.objectWithFields({ spider_bot_rules: a.string(), browser_patterns: a.string() }) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsBrowserPropertiesConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); const b = a.Typed; a.coerce; a = b.objectWithFields({ delayInMs: b.allowNull(b.number()), enableEventSuppression: b.allowNull(b.boolean()), enableBackupTimeout: b.allowNull(b.boolean()), experiment: b.allowNull(b.string()), fbcParamsConfig: b.allowNull(b.objectWithFields({ params: b.arrayOf(b.objectWithFields({ ebp_path: b.string(), prefix: b.string(), query: b.string() })) })), enableFbcParamSplitIOS: b.allowNull(b.boolean()), enableFbcParamSplitAndroid: b.allowNull(b.boolean()) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsBufferConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); const b = a.Typed; a.coerce; a = b.objectWithFields({ delayInMs: b.number(), experimentName: b.allowNull(b.string()), enableMultiEid: b.allowNull(b.boolean()), onlyBufferPageView: b.allowNull(b.boolean()) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsCCRuleEvaluatorConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); const b = a.Typed; a.coerce; a = b.objectWithFields({ ccRules: b.allowNull(b.arrayOf(b.allowNull(b.objectWithFields({ id: b.allowNull(b.stringOrNumber()), rule: b.allowNull(b.objectOrString()) })))), wcaRules: b.allowNull(b.arrayOf(b.allowNull(b.objectWithFields({ id: b.allowNull(b.stringOrNumber()), rule: b.allowNull(b.objectOrString()) })))), valueRules: b.allowNull(b.arrayOf(b.allowNull(b.objectWithFields({ id: b.allowNull(b.string()), rule: b.allowNull(b.object()) })))), blacklistedIframeReferrers: b.allowNull(b.mapOf(b.boolean())) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsCensor', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsUtils'); const b = a.each; a = a.map; function c(a) {
            if (a == null) {
              return null;
            } if (a === '') {
              return '';
            } if (typeof a === 'number') {
              a = a.toString();
            } else if (typeof a !== 'string') {
              return null;
            } const b = /[A-Z]/g; const c = /[a-z]/g; const d = /\d/g; const e = /[\0-\x1F0-9A-Z\x7F-\u201C\u201E-\uD7FF\uE000-\uFFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/gi; a = a.replace(b, '^'); a = a.replace(c, '*'); a = a.replace(d, '#'); a = a.replace(e, '~'); return a;
          } const d = ['ph', 'phone', 'em', 'email', 'fn', 'ln', 'f_name', 'l_name', 'external_id', 'gender', 'db', 'dob', 'ct', 'st', 'zp', 'country', 'city', 'state', 'zip', 'zip_code', 'zp', 'cn', 'firstName', 'surname', 'pn', 'gender', 'name', 'lastName', 'bd', 'first_name', 'address', 'last_name', 'birthday', 'email_preferences_token', 'consent_global_email_nl', 'consent_global_email_drip', 'consent_fide_email_nl', 'consent_fide_email_drip', '$country', '$city', '$gender', 'dOB', 'user_email', 'email_sha256', 'primaryPhone', 'lastNameEng', 'firstNameEng', 'eMailAddress', 'pp', 'postcode', 'profile_name', 'account_name', 'email_paypal', 'zip_code', 'fbq_custom_name']; a = a(d, (a) => {
            return 'ud['.concat(a, ']');
          }).concat(a(d, (a) => {
            return 'udff['.concat(a, ']');
          })); function e(a) {
            const e = {}; b(d, (b) => {
              const d = c(a[b]); d != null && (e[b] = d);
            }); return e;
          }k.exports = { censoredIneligibleKeysWithUD: a, getCensoredPayload: e, censorPII: c };
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsClientHintConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); const b = a.Typed; a.coerce; a = b.objectWithFields({ delayInMs: b.allowNull(b.number()), disableBackupTimeout: b.allowNull(b.boolean()) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsClientSidePixelForkingConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); a.coerce; a = a.Typed; a = a.objectWithFields({ forkedPixelIds: a.allowNull(a.arrayOf(a.string())), forkedPixelIdsInBrowserChannel: a.allowNull(a.arrayOf(a.string())), forkedPixelIdsInServerChannel: a.allowNull(a.arrayOf(a.string())), forkedPixelsInBrowserChannel: a.arrayOf(a.objectWithFields({ destination_pixel_id: a.string(), domains: a.allowNull(a.arrayOf(a.string())) })), forkedPixelsInServerChannel: a.arrayOf(a.objectWithFields({ destination_pixel_id: a.string(), domains: a.allowNull(a.arrayOf(a.string())) })) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('signalsFBEventsCoerceAutomaticMatchingConfig', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); const b = a.coerce; a = a.Typed; const c = a.objectWithFields({ selectedMatchKeys: a.arrayOf(a.string()) }); k.exports = function (a) {
            return b(a, c);
          };
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('signalsFBEventsCoerceBatchingConfig', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsTyped'); const b = a.Typed; const c = a.coerce; const d = a.enforce; const e = function (a) {
            const e = c(a, b.objectWithFields({ max_batch_size: b.number(), wait_time_ms: b.number() })); return e != null ? { batchWaitTimeMs: e.wait_time_ms, maxBatchSize: e.max_batch_size } : d(a, b.objectWithFields({ batchWaitTimeMs: b.number(), maxBatchSize: b.number() }));
          }; k.exports = function (a) {
            return c(a, e);
          };
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('signalsFBEventsCoerceInferedEventsConfig', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); const b = a.coerce; a = a.Typed; const c = a.objectWithFields({ buttonSelector: a.allowNull(a.string()), disableRestrictedData: a.allowNull(a.boolean()) }); k.exports = function (a) {
            return b(a, c);
          };
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('signalsFBEventsCoerceParameterExtractors', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsUtils'); const b = a.filter; const c = a.map; const d = f.getFbeventsModules('signalsFBEventsCoerceStandardParameter'); function e(a) {
            if (a == null || J(a) !== 'object') {
              return null;
            } let b = a.domain_uri; let c = a.event_type; let d = a.extractor_type; a = a.id; b = typeof b === 'string' ? b : null; c = c != null && typeof c === 'string' && c !== '' ? c : null; a = a != null && typeof a === 'string' && a !== '' ? a : null; d = d === 'CONSTANT_VALUE' || d === 'CSS' || d === 'GLOBAL_VARIABLE' || d === 'GTM' || d === 'JSON_LD' || d === 'META_TAG' || d === 'OPEN_GRAPH' || d === 'RDFA' || d === 'SCHEMA_DOT_ORG' || d === 'URI' ? d : null; return b != null && c != null && a != null && d != null ? { domain_uri: b, event_type: c, extractor_type: d, id: a } : null;
          } function g(a) {
            if (a == null || J(a) !== 'object') {
              return null;
            } a = a.extractor_config; if (a == null || J(a) !== 'object') {
              return null;
            } let b = a.parameter_type; a = a.value; b = d(b); a = a != null && typeof a === 'string' && a !== '' ? a : null; return b != null && a != null ? { parameter_type: b, value: a } : null;
          } function h(a) {
            if (a == null || J(a) !== 'object') {
              return null;
            } let b = a.parameter_type; a = a.selector; b = d(b); a = a != null && typeof a === 'string' && a !== '' ? a : null; return b != null && a != null ? { parameter_type: b, selector: a } : null;
          } function i(a) {
            if (a == null || J(a) !== 'object') {
              return null;
            } a = a.extractor_config; if (a == null || J(a) !== 'object') {
              return null;
            } a = a.parameter_selectors; if (Array.isArray(a)) {
              a = c(a, h); const d = b(a, Boolean); if (a.length === d.length) {
                return { parameter_selectors: d };
              }
            } return null;
          } function j(a) {
            if (a == null || J(a) !== 'object') {
              return null;
            } a = a.extractor_config; if (a == null || J(a) !== 'object') {
              return null;
            } let b = a.context; let c = a.parameter_type; a = a.value; b = b != null && typeof b === 'string' && b !== '' ? b : null; c = d(c); a = a != null && typeof a === 'string' && a !== '' ? a : null; return b != null && c != null && a != null ? { context: b, parameter_type: c, value: a } : null;
          } function l(a) {
            let b = e(a); if (b == null || a == null || J(a) !== 'object') {
              return null;
            } const c = b.domain_uri; const d = b.event_type; const f = b.extractor_type; b = b.id; if (f === 'CSS') {
              var h = i(a); if (h != null) {
                return { domain_uri: c, event_type: d, extractor_config: h, extractor_type: 'CSS', id: b };
              }
            } if (f === 'CONSTANT_VALUE') {
              h = g(a); if (h != null) {
                return { domain_uri: c, event_type: d, extractor_config: h, extractor_type: 'CONSTANT_VALUE', id: b };
              }
            } if (f === 'GLOBAL_VARIABLE') {
              return { domain_uri: c, event_type: d, extractor_type: 'GLOBAL_VARIABLE', id: b };
            } if (f === 'GTM') {
              return { domain_uri: c, event_type: d, extractor_type: 'GTM', id: b };
            } if (f === 'JSON_LD') {
              return { domain_uri: c, event_type: d, extractor_type: 'JSON_LD', id: b };
            } if (f === 'META_TAG') {
              return { domain_uri: c, event_type: d, extractor_type: 'META_TAG', id: b };
            } if (f === 'OPEN_GRAPH') {
              return { domain_uri: c, event_type: d, extractor_type: 'OPEN_GRAPH', id: b };
            } if (f === 'RDFA') {
              return { domain_uri: c, event_type: d, extractor_type: 'RDFA', id: b };
            } if (f === 'SCHEMA_DOT_ORG') {
              return { domain_uri: c, event_type: d, extractor_type: 'SCHEMA_DOT_ORG', id: b };
            } if (f === 'URI') {
              h = j(a); if (h != null) {
                return { domain_uri: c, event_type: d, extractor_config: h, extractor_type: 'URI', id: b };
              }
            } return null;
          }k.exports = l;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('signalsFBEventsCoercePixelID', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsLogging'); const b = a.logUserError; a = f.getFbeventsModules('SignalsFBEventsTyped'); const c = a.Typed; const d = a.coerce; function e(a) {
            a = d(a, c.fbid()); if (a == null) {
              const e = JSON.stringify(a); b({ pixelID: e != null ? e : 'undefined', type: 'INVALID_PIXEL_ID' }); return null;
            } return a;
          }k.exports = e;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsCoercePrimitives', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsUtils'); const b = a.filter; const c = a.map; const d = a.reduce; function e(a) {
            return Object.values(a);
          } function g(a) {
            return typeof a === 'boolean' ? a : null;
          } function h(a) {
            return typeof a === 'number' ? a : null;
          } function i(a) {
            return typeof a === 'string' ? a : null;
          } function j(a) {
            return J(a) === 'object' && !Array.isArray(a) && a != null ? a : null;
          } function l(a) {
            return Array.isArray(a) ? a : null;
          } function m(a, b) {
            return e(a).includes(b) ? b : null;
          } function n(a, d) {
            a = l(a); return a == null
              ? null
              : b(c(a, d), (a) => {
                return a != null;
              });
          } function o(a, b) {
            const c = l(a); if (c == null) {
              return null;
            } a = n(a, b); return a == null ? null : a.length === c.length ? a : null;
          } function p(a, b) {
            const c = j(a); if (c == null) {
              return null;
            } a = d(Object.keys(c), (a, d) => {
              const e = b(c[d]); return e == null ? a : v(v({}, a), {}, z({}, d, e));
            }, {}); return Object.keys(c).length === Object.keys(a).length ? a : null;
          } function q(a) {
            const b = function (b) {
              return a(b);
            }; b.nullable = !0; return b;
          } function r(a, b) {
            const c = j(a); if (c == null) {
              return null;
            } a = Object.keys(b).reduce((a, d) => {
              if (a == null) {
                return null;
              } let e = b[d]; const f = c[d]; if (e.nullable === !0 && f == null) {
                return v(v({}, a), {}, z({}, d, null));
              } e = e(f); return e == null ? null : v(v({}, a), {}, z({}, d, e));
            }, {}); return a != null ? Object.freeze(a) : null;
          }k.exports = { coerceArray: l, coerceArrayFilteringNulls: n, coerceArrayOf: o, coerceBoolean: g, coerceEnum: m, coerceMapOf: p, coerceNullableField: q, coerceNumber: h, coerceObject: j, coerceObjectWithFields: r, coerceString: i };
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('signalsFBEventsCoerceStandardParameter', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsUtils'); a = a.FBSet; const b = new a(['content_category', 'content_ids', 'content_name', 'content_type', 'currency', 'contents', 'num_items', 'order_id', 'predicted_ltv', 'search_string', 'status', 'subscription_id', 'value', 'id', 'item_price', 'quantity', 'ct', 'db', 'em', 'external_id', 'fn', 'ge', 'ln', 'namespace', 'ph', 'st', 'zp']); function c(a) {
            return typeof a === 'string' && b.has(a) ? a : null;
          }k.exports = c;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsConfigLoadedEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); const b = f.getFbeventsModules('signalsFBEventsCoercePixelID'); function c(a) {
            a = b(a); return a != null ? [a] : null;
          }a = new a(c); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsConfigStore', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('signalsFBEventsCoerceAutomaticMatchingConfig'); const b = f.getFbeventsModules('signalsFBEventsCoerceBatchingConfig'); const c = f.getFbeventsModules('signalsFBEventsCoerceInferedEventsConfig'); const d = f.getFbeventsModules('signalsFBEventsCoercePixelID'); let e = f.getFbeventsModules('SignalsFBEventsLogging'); const g = e.logError; const h = f.getFbeventsModules('SignalsFBEventsQE'); e = f.getFbeventsModules('SignalsFBEventsBrowserPropertiesConfigTypedef'); const i = f.getFbeventsModules('SignalsFBEventsBufferConfigTypedef'); const j = f.getFbeventsModules('SignalsFBEventsESTRuleEngineConfigTypedef'); const l = f.getFbeventsModules('SignalsFBEventsDataProcessingOptionsConfigTypedef'); const m = f.getFbeventsModules('SignalsFBEventsDisabledExtensionsConfigTypedef'); const n = f.getFbeventsModules('SignalsFBEventsDefaultCustomDataConfigTypedef'); const o = f.getFbeventsModules('SignalsFBEventsMicrodataConfigTypedef'); const p = f.getFbeventsModules('SignalsFBEventsOpenBridgeConfigTypedef'); const q = f.getFbeventsModules('SignalsFBEventsParallelFireConfigTypedef'); const r = f.getFbeventsModules('SignalsFBEventsProhibitedSourcesTypedef'); const s = f.getFbeventsModules('SignalsFBEventsTriggerSgwPixelTrackCommandConfigTypedef'); let t = f.getFbeventsModules('SignalsFBEventsTyped'); const u = t.Typed; const v = t.coerce; t = f.getFbeventsModules('SignalsFBEventsUnwantedDataTypedef'); const x = f.getFbeventsModules('SignalsFBEventsEventValidationConfigTypedef'); const A = f.getFbeventsModules('SignalsFBEventsProtectedDataModeConfigTypedef'); const B = f.getFbeventsModules('SignalsFBEventsClientHintConfigTypedef'); const C = f.getFbeventsModules('SignalsFBEventsCCRuleEvaluatorConfigTypedef'); const D = f.getFbeventsModules('SignalsFBEventsRestrictedDomainsConfigTypedef'); const E = f.getFbeventsModules('SignalsFBEventsIABPCMAEBridgeConfigTypedef'); const F = f.getFbeventsModules('SignalsFBEventsCookieDeprecationLabelConfigTypedef'); const G = f.getFbeventsModules('SignalsFBEventsUnwantedEventsConfigTypedef'); const H = f.getFbeventsModules('SignalsFBEventsUnwantedEventNamesConfigTypedef'); const I = f.getFbeventsModules('SignalsFBEventsUnwantedParamsConfigTypedef'); const J = f.getFbeventsModules('SignalsFBEventsStandardParamChecksConfigTypedef'); const K = f.getFbeventsModules('SignalsFBEventsClientSidePixelForkingConfigTypedef'); const L = f.getFbeventsModules('SignalsFBEventsCookieConfigTypedef'); const M = f.getFbeventsModules('SignalsFBEventsGatingConfigTypedef'); const N = f.getFbeventsModules('SignalsFBEventsProhibitedPixelConfigTypedef'); const O = f.getFbeventsModules('SignalsFBEventsWebchatConfigTypedef'); const P = f.getFbeventsModules('SignalsFBEventsImagePixelOpenBridgeConfigTypedef'); const Q = f.getFbeventsModules('SignalsFBEventsBotBlockingConfigTypedef'); const aa = f.getFbeventsModules('SignalsFBEventsURLMetadataConfigTypedef'); const R = 'global'; const ba = { automaticMatching: a, openbridge: p, batching: b, inferredEvents: c, microdata: o, prohibitedSources: r, unwantedData: t, dataProcessingOptions: l, parallelfire: q, buffer: i, browserProperties: e, defaultCustomData: n, estRuleEngine: j, eventValidation: x, protectedDataMode: A, clientHint: B, ccRuleEvaluator: C, restrictedDomains: D, IABPCMAEBridge: E, cookieDeprecationLabel: F, unwantedEvents: G, unwantedEventNames: H, unwantedParams: I, standardParamChecks: J, clientSidePixelForking: K, cookie: L, gating: M, prohibitedPixels: N, triggersgwpixeltrackcommand: s, webchat: O, imagepixelopenbridge: P, botblocking: Q, disabledExtensions: m, urlMetadata: aa }; a = (function () {
            function a() {
              let b; w(this, a); z(this, '_configStore', (b = { automaticMatching: {}, batching: {}, inferredEvents: {}, microdata: {}, prohibitedSources: {}, unwantedData: {}, dataProcessingOptions: {}, openbridge: {}, parallelfire: {}, buffer: {}, defaultCustomData: {}, estRuleEngine: {} }, z(z(z(z(z(z(z(z(z(z(b, 'defaultCustomData', {}), 'browserProperties', {}), 'eventValidation', {}), 'protectedDataMode', {}), 'clientHint', {}), 'ccRuleEvaluator', {}), 'restrictedDomains', {}), 'IABPCMAEBridge', {}), 'cookieDeprecationLabel', {}), 'unwantedEvents', {}), z(z(z(z(z(z(z(z(z(z(b, 'unwantedParams', {}), 'standardParamChecks', {}), 'unwantedEventNames', {}), 'clientSidePixelForking', {}), 'cookie', {}), 'gating', {}), 'prohibitedPixels', {}), 'triggersgwpixeltrackcommand', {}), 'webchat', {}), 'imagepixelopenbridge', {}), z(z(z(b, 'botblocking', {}), 'disabledExtensions', {}), 'urlMetadata', {})));
            } return y(a, [{ key: 'set', value(a, b, c) {
              a = a == null ? R : d(a); if (a == null) {
                return;
              } b = v(b, u.string()); if (b == null) {
                return;
              } if (this._configStore[b] == null) {
                return;
              } this._configStore[b][a] = ba[b] != null ? ba[b](c) : c;
            } }, { key: 'setExperimental', value(a) {
              a = v(a, u.objectWithFields({ config: u.object(), experimentName: u.string(), pixelID: d, pluginName: u.string() })); if (a == null) {
                return;
              } const b = a.config; const c = a.experimentName; const e = a.pixelID; a = a.pluginName; h.isInTest(c) && this.set(e, a, b);
            } }, { key: 'get', value(a, b) {
              return this._configStore[b][a != null ? a : R];
            } }, { key: 'getWithGlobalFallback', value(a, b) {
              let c = R; b = this._configStore[b]; a != null && Object.prototype.hasOwnProperty.call(b, a) && (c = a); return b[c];
            } }, { key: 'getAutomaticMatchingConfig', value(a) {
              g(new Error('Calling legacy api getAutomaticMatchingConfig')); return this.get(a, 'automaticMatching');
            } }, { key: 'getInferredEventsConfig', value(a) {
              g(new Error('Calling legacy api getInferredEventsConfig')); return this.get(a, 'inferredEvents');
            } }]);
          }()); k.exports = new a();
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsCookieConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); const b = a.Typed; a.coerce; a = b.objectWithFields({ fbcParamsConfig: b.allowNull(b.objectWithFields({ params: b.arrayOf(b.objectWithFields({ ebp_path: b.string(), prefix: b.string(), query: b.string() })) })), enableFbcParamSplitAll: b.allowNull(b.boolean()), maxMultiFbcQueueSize: b.allowNull(b.number()), enableFbcParamSplitSafariOnly: b.allowNull(b.boolean()) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsCookieDeprecationLabelConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); const b = a.Typed; a.coerce; a = b.objectWithFields({ delayInMs: b.allowNull(b.number()), disableBackupTimeout: b.allowNull(b.boolean()) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsCorrectPIIPlacement', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsLogging'); const b = a.logError; a = f.getFbeventsModules('SignalsFBEventsUtils'); const c = a.each; const d = a.keys; a = f.getFbeventsModules('SignalsPixelPIIUtils'); const e = a.isZipCode; a = f.getFbeventsModules('SignalsPixelPIIUtils'); const g = a.isEmail; const h = a.isPhoneNumber; const i = a.getGenderCharacter; f.getFbeventsModules('SignalsFBEventsQE'); a = f.getFbeventsModules('SignalsPixelPIIConstants'); const j = a.PII_KEYS_TO_ALIASES_EXPANDED; function l(a) {
            try {
              if (a == null || J(a) !== 'object') {
                return a;
              } const f = {}; c(d(a), (b) => {
                typeof b === 'string' && typeof b.toLowerCase === 'function' ? f[b.toLowerCase()] = a[b] : f[b] = a[b];
              }); c(d(j), (b) => {
                if (a[b] != null) {
                  return;
                } const d = j[b]; c(d, (c) => {
                  a[b] == null && c in f && f[c] != null && (a[b] = f[c]);
                });
              }); c(d(a), (b) => {
                b = a[b]; if (b == null) {
                  return;
                } if (a.em == null && g(b)) {
                  a.em = b; return;
                } if (a.ph == null && h(b)) {
                  a.ph = b; return;
                } if (a.zp == null && e(b)) {
                  a.zp = b; return;
                } if (a.ge == null && typeof b === 'string' && typeof b.toLowerCase === 'function' && (i(b.toLowerCase()) == 'm' || i(b.toLowerCase()) == 'f')) {
                  a.ge = i(b);
                }
              });
            } catch (a) {
              a.message = `[Placement Fix]:${a.message}`, b(a);
            } return a;
          }k.exports = l;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsDataProcessingOptionsConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); a = a.Typed; a = a.objectWithFields({ dataProcessingOptions: a.withValidation({ def: a.arrayOf(a.string()), validators: [function (a) {
            return a.reduce((a, b) => {
              return a === !0 && b === 'LDU';
            }, !0);
          }] }), dataProcessingCountry: a.withValidation({ def: a.allowNull(a.number()), validators: [function (a) {
            return a === null || a === 0 || a === 1;
          }] }), dataProcessingState: a.withValidation({ def: a.allowNull(a.number()), validators: [function (a) {
            return a === null || a === 0 || a === 1e3;
          }] }) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsDefaultCustomDataConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); const b = a.Typed; a.coerce; a = b.objectWithFields({ enable_order_id: b.boolean(), enable_value: b.boolean(), enable_currency: b.boolean(), enable_contents: b.boolean(), enable_content_ids: b.boolean(), enable_content_type: b.boolean(), experiment: b.allowNull(b.string()) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsDisabledExtensionsConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); a = a.Typed; a = a.objectWithFields({ disabledExtensions: a.withValidation({ def: a.arrayOf(a.string()), validators: [function (a) {
            return a.reduce((a, b) => {
              return a === !0 && b === 'whatsapp_marketing_messaging_customer_subscription';
            }, !0);
          }] }) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('signalsFBEventsDoAutomaticMatching', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsUtils'); const b = a.keys; const c = f.getFbeventsModules('SignalsFBEventsConfigStore'); a = f.getFbeventsModules('SignalsFBEventsEvents'); const d = a.piiAutomatched; function e(a, e, f, g, h, i) {
            a = i != null ? i : c.get(e.id, 'automaticMatching'); if (b(f).length > 0 && a != null) {
              i = a.selectedMatchKeys; for (a in f) {
                i.includes(a) && (e.userDataFormFields[a] = f[a], h != null && a in h && (e.censoredUserDataFormatFormFields[a] = h[a]), g != null && a in g && (e.alternateUserDataFormFields[a] = g[a]));
              } d.trigger(e);
            }
          }k.exports = e;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsESTRuleEngineConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); const b = a.Typed; a.coerce; a = b.objectWithFields({ experimentName: b.allowNull(b.string()) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsEvents', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); let b = f.getFbeventsModules('SignalsFBEventsConfigLoadedEvent'); const c = f.getFbeventsModules('SignalsFBEventsFiredEvent'); const d = f.getFbeventsModules('SignalsFBEventsGetCustomParametersEvent'); const e = f.getFbeventsModules('SignalsFBEventsGetIWLParametersEvent'); const g = f.getFbeventsModules('SignalsFBEventsIWLBootStrapEvent'); const h = f.getFbeventsModules('SignalsFBEventsPIIAutomatchedEvent'); const i = f.getFbeventsModules('SignalsFBEventsPIIConflictingEvent'); const j = f.getFbeventsModules('SignalsFBEventsPIIInvalidatedEvent'); const l = f.getFbeventsModules('SignalsFBEventsPluginLoadedEvent'); const m = f.getFbeventsModules('SignalsFBEventsSetEventIDEvent'); const n = f.getFbeventsModules('SignalsFBEventsSetIWLExtractorsEvent'); const o = f.getFbeventsModules('SignalsFBEventsSetESTRules'); const p = f.getFbeventsModules('SignalsFBEventsSetCCRules'); const q = f.getFbeventsModules('SignalsFBEventsValidateCustomParametersEvent'); const r = f.getFbeventsModules('SignalsFBEventsLateValidateCustomParametersEvent'); const s = f.getFbeventsModules('SignalsFBEventsValidateUrlParametersEvent'); const t = f.getFbeventsModules('SignalsFBEventsValidateGetClickIDFromBrowserProperties'); const u = f.getFbeventsModules('SignalsFBEventsExtractPII'); const v = f.getFbeventsModules('SignalsFBEventsGetAutomaticParametersEvent'); const w = f.getFbeventsModules('SignalsFBEventsSendEventEvent'); const x = f.getFbeventsModules('SignalsFBEventsAutomaticPageViewEvent'); const y = f.getFbeventsModules('SignalsFBEventsWebChatEvent'); b = { configLoaded: b, execEnd: new a(), fired: c, getCustomParameters: d, getIWLParameters: e, iwlBootstrap: g, piiAutomatched: h, piiConflicting: i, piiInvalidated: j, pluginLoaded: l, setEventId: m, setIWLExtractors: n, setESTRules: o, setCCRules: p, validateCustomParameters: q, lateValidateCustomParameters: r, validateUrlParameters: s, getClickIDFromBrowserProperties: t, extractPii: u, getAutomaticParameters: v, SendEventEvent: w, automaticPageView: x, webchatEvent: y }; k.exports = b;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsEventValidationConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); const b = a.Typed; a.coerce; a = b.objectWithFields({ unverifiedEventNames: b.allowNull(b.arrayOf(b.string())), enableEventSanitization: b.allowNull(b.boolean()), restrictedEventNames: b.allowNull(b.arrayOf(b.string())) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsExperimentNames', () => {
      return (function (f, g, h, i) {
        const j = { exports: {} }; j.exports; (function () {
          'use strict'; j.exports = { NO_OP_EXPERIMENT: 'no_op_exp', PROCESS_AUTOMATIC_PARAMETERS: 'process_automatic_parameters', AUTOMATIC_PARAMETERS_JSON_AUTO_FIX: 'automatic_parameters_json_auto_fix', BUTTON_CLICK_OPTIMIZE_EXPERIMENT_V2: 'button_click_optimize_experiment_v2', MICRODATA_REFACTOR_MIGRATION: 'microdata_refactor_migration' };
        })(); return j.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsExperimentsTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); const b = a.Typed; a.coerce; a.enforce; a = b.arrayOf(b.objectWithFields({ allocation: b.number(), code: b.string(), name: b.string(), passRate: b.number() })); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsExperimentsV2Typedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); const b = a.Typed; a.coerce; a.enforce; a = b.arrayOf(b.objectWithFields({ evaluationType: b.enumeration({ eventlevel: 'EVENT_LEVEL', pageloadlevel: 'PAGE_LOAD_LEVEL' }), universe: b.string(), allocation: b.number(), code: b.string(), name: b.string(), passRate: b.number() })); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsExtractPII', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); const b = f.getFbeventsModules('SignalsFBEventsPixelTypedef'); let c = f.getFbeventsModules('SignalsFBEventsTyped'); const d = c.Typed; const e = c.coerce; function g(a, c, f) {
            c = e(a, b); f = d.allowNull(d.object()); a = d.allowNull(d.object()); return c != null ? [{ pixel: c, form: f, button: a }] : null;
          }c = new a(g); k.exports = c;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsFBQ', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsEventValidation'); const b = f.getFbeventsModules('handleEventIdOverride'); const c = f.getFbeventsModules('SignalsFBEventsConfigStore'); let d = f.getFbeventsModules('SignalsFBEventsEvents'); const e = d.configLoaded; const j = f.getFbeventsModules('SignalsFBEventsFireLock'); const l = f.getFbeventsModules('SignalsFBEventsJSLoader'); d = f.getFbeventsModules('SignalsFBEventsLogging'); const m = f.getFbeventsModules('SignalsFBEventsOptIn'); let n = f.getFbeventsModules('SignalsFBEventsUtils'); f.getFbeventsModules('signalsFBEventsGetIsIosInAppBrowser'); const o = f.getFbeventsModules('SignalsFBEventsGetValidUrl'); const p = f.getFbeventsModules('SignalsFBEventsResolveLink'); let q = f.getFbeventsModules('SignalsPixelCookieUtils'); q.CLICK_ID_PARAMETER; q.readPackedCookie; q.CLICKTHROUGH_COOKIE_NAME; f.getFbeventsModules('SignalsFBEventsQE'); const r = f.getFbeventsModules('SignalsFBEventsModuleEncodings'); const s = f.getFbeventsModules('SignalsParamList'); q = f.getFbeventsModules('signalsFBEventsSendEvent'); const t = q.sendEvent; q = f.getFbeventsModules('SignalsFBEventsAsyncParamUtils'); const u = q.registerAsyncParamAllSettledListener; const x = q.flushAsyncParamEventQueue; const A = n.each; const B = n.keys; const D = n.map; const E = n.some; const F = d.logError; const G = d.logUserError; const H = f.getFbeventsModules('SignalsFBEventsGuardrail'); const I = { AutomaticMatching: !0, AutomaticMatchingForPartnerIntegrations: !0, DefaultCustomData: !0, Buffer: !0, CommonIncludes: !0, FirstPartyCookies: !0, IWLBootstrapper: !0, IWLParameters: !0, IdentifyIntegration: !0, InferredEvents: !0, Microdata: !0, MicrodataJsonLd: !0, OpenBridge: !0, ParallelFire: !0, ProhibitedSources: !0, Timespent: !0, UnwantedData: !0, LocalComputation: !0, IABPCMAEBridge: !0, BrowserProperties: !0, ESTRuleEngine: !0, EventValidation: !0, ProtectedDataMode: !0, PrivacySandbox: !0, ClientHint: !0, CCRuleEvaluator: !0, ProhibitedPixels: !0, LastExternalReferrer: !0, CookieDeprecationLabel: !0, UnwantedEvents: !0, UnwantedEventNames: !0, UnwantedParams: !0, StandardParamChecks: !0, ShopifyAppIntegratedPixel: !0, clientSidePixelForking: !0, ShadowTest: !0, TopicsAPI: !0, Gating: !0, AutomaticParameters: !0, LeadEventId: !0, EngagementData: !0, TriggerSgwPixelTrackCommand: !0, DomainBlocking: !0, WebChat: !0, ScrollDepth: !0, PageMetadata: !0, WebsitePerformance: !0, PdpDataPrototype: !0, ImagePixelOpenBridge: !0, WebpageContentExtractor: !0, BotBlocking: !0, URLParamSchematization: !0, URLMetadata: !0 }; const J = { Track: 0, TrackCustom: 4, TrackSingle: 1, TrackSingleCustom: 2, TrackSingleSystem: 3, TrackSystem: 5 }; const K = 'global_config'; const L = 200; q = ['InferredEvents', 'Microdata', 'AutomaticParameters', 'EngagementData', 'PageMetadata', 'ScrollDepth', 'WebChat']; const M = { AutomaticSetup: q }; const N = { AutomaticMatching: ['inferredevents', 'identity'], AutomaticMatchingForPartnerIntegrations: ['automaticmatchingforpartnerintegrations'], CommonIncludes: ['commonincludes'], DefaultCustomData: ['defaultcustomdata'], FirstPartyCookies: ['cookie'], IWLBootstrapper: ['iwlbootstrapper'], IWLParameters: ['iwlparameters'], ESTRuleEngine: ['estruleengine'], IdentifyIntegration: ['identifyintegration'], Buffer: ['buffer'], InferredEvents: ['inferredevents', 'identity'], Microdata: ['microdata', 'identity'], MicrodataJsonLd: ['jsonld_microdata'], ParallelFire: ['parallelfire'], ProhibitedSources: ['prohibitedsources'], Timespent: ['timespent'], UnwantedData: ['unwanteddata'], LocalComputation: ['localcomputation'], IABPCMAEBridge: ['iabpcmaebridge'], BrowserProperties: ['browserproperties'], EventValidation: ['eventvalidation'], ProtectedDataMode: ['protecteddatamode'], PrivacySandbox: ['privacysandbox'], ClientHint: ['clienthint'], CCRuleEvaluator: ['ccruleevaluator'], ProhibitedPixels: ['prohibitedpixels'], LastExternalReferrer: ['lastexternalreferrer'], CookieDeprecationLabel: ['cookiedeprecationlabel'], UnwantedEvents: ['unwantedevents'], UnwantedEventNames: ['unwantedeventnames'], UnwantedParams: ['unwantedparams'], ShopifyAppIntegratedPixel: ['shopifyappintegratedpixel'], clientSidePixelForking: ['clientsidepixelforking'], TopicsAPI: ['topicsapi'], Gating: ['gating'], AutomaticParameters: ['automaticparameters'], LeadEventId: ['leadeventid'], EngagementData: ['engagementdata'], TriggerSgwPixelTrackCommand: ['triggersgwpixeltrackcommand'], DomainBlocking: ['domainblocking'], WebChat: ['webchat'], ScrollDepth: ['scrolldepth'], PageMetadata: ['pagemetadata'], WebsitePerformance: ['websiteperformance'], PdpDataPrototype: ['pdpdataprototype'], ImagePixelOpenBridge: ['imagepixelopenbridge'], WebpageContentExtractor: ['webpagecontentextractor'], BotBlocking: ['botblocking'], URLParamSchematization: ['urlparamschematization'], URLMetadata: ['urlmetadata'] }; function O(a) {
            return !!(I[a] || M[a]);
          } const P = function (a, b, c, d, e) {
            const f = new s((a) => {
              return { finalValue: a };
            }); f.append('v', b); f.append('r', c); d === !0 && f.append('no_min', !0); e != null && e != '' && f.append('domain', e); r.addEncodings(f); return ''.concat(l.CONFIG.CDN_BASE_URL, 'signals/config/').concat(a, '?').concat(f.toQueryString());
          }; function Q(a, b, c, d, e) {
            l.loadJSFile(P(a, b, c, e, d));
          }n = (function () {
            function d(a, b) {
              const e = this; w(this, d); z(this, 'VALID_FEATURES', I); z(this, 'optIns', new m(M)); z(this, 'configsLoaded', {}); z(this, 'locks', j.global); z(this, 'pluginConfig', c); z(this, 'disableFirstPartyCookies', !1); z(this, 'disableAutoConfig', !1); z(this, 'disableErrorLogging', !1); z(this, 'asyncParamFetchers', new Map()); z(this, 'eventQueue', []); z(this, 'asyncParamPromisesAllSettled', !0); z(this, 'disableAsyncParamBackupTimeout', !1); this.VERSION = a.version; this.RELEASE_SEGMENT = a._releaseSegment; this.pixelsByID = b; this.fbq = a; A(a.pendingConfigs || [], (a) => {
                return e.locks.lockConfig(a);
              });
            } return y(d, [{ key: 'optIn', value(a, b) {
              const c = this; const d = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : !1; if (typeof b !== 'string' || !O(b)) {
                throw new Error(`Invalid Argument: "${b}" is not a valid opt-in feature`);
              } O(b) && (this.optIns.optIn(a, b, d), A([b].concat(C(M[b] || [])), (a) => {
                N[a] && A(N[a], (a) => {
                  return c.fbq.loadPlugin(a);
                });
              })); return this;
            } }, { key: 'optOut', value(a, b) {
              this.optIns.optOut(a, b); return this;
            } }, { key: 'consent', value(a) {
              a === 'revoke' ? this.locks.lockConsent() : a === 'grant' ? this.locks.unlockConsent() : G({ action: a, type: 'INVALID_CONSENT_ACTION' }); return this;
            } }, { key: 'setUserProperties', value(a, b) {
              const c = this.pluginConfig.get(null, 'dataProcessingOptions'); if (c != null && c.dataProcessingOptions.includes('LDU')) {
                return;
              } if (!Object.prototype.hasOwnProperty.call(this.pixelsByID, a)) {
                G({ pixelID: a, type: 'PIXEL_NOT_INITIALIZED' }); return;
              } this.trackSingleSystem('user_properties', a, 'UserProperties', v({}, b));
            } }, { key: 'trackSingle', value(b, c, d, e) {
              a.validateEventAndLog(c, d); return this.trackSingleGeneric(b, c, d, J.TrackSingle, e);
            } }, { key: 'trackSingleCustom', value(a, b, c, d) {
              return this.trackSingleGeneric(a, b, c, J.TrackSingleCustom, d);
            } }, { key: 'trackSingleSystem', value(a, b, c, d, e, f, g) {
              return this.trackSingleGeneric(b, c, d, J.TrackSingleSystem, e || null, a, f, g);
            } }, { key: 'trackSingleGeneric', value(a, b, c, d, e, f, g, h) {
              a = typeof a === 'string' ? a : a.id; h = h; (h == null || h === '') && (h = Date.now().toString()); if (!Object.prototype.hasOwnProperty.call(this.pixelsByID, a)) {
                var i = { pixelID: a, type: 'PIXEL_NOT_INITIALIZED' }; f == null ? G(i) : F(new Error(`${i.type} ${i.pixelID}`)); return this;
              }i = this.getDefaultSendData(a, b, e, h); i.customData = c; f != null && (i.customParameters = { es: f }); g != null && (i.customParameters = v(v({}, i.customParameters), g)); i.customParameters = v(v({}, i.customParameters), {}, { tm: ''.concat(d) }); this.fire(i, !1); return this;
            } }, { key: '_validateSend', value(b, c) {
              if (!b.eventName || !b.eventName.length) {
                if (H.eval('fix_missing_event_name_error', b.pixelId)) {
                  b.eventName = '', b.customParameters = v(v({}, b.customParameters), {}, { 'ie[d]': '1' }), G({ type: 'NO_EVENT_NAME' });
                } else {
                  throw new Error('Event name not specified');
                }
              } if (!b.pixelId || !b.pixelId.length) {
                throw new Error('PixelId not specified');
              } b.set && A(D(B(b.set), (b) => {
                return a.validateMetadata(b);
              }), (a) => {
                if (a.error) {
                  throw new Error(a.error);
                } a.warnings.length && A(a.warnings, G);
              }); if (c) {
                c = a.validateEvent(b.eventName, b.customData || {}); if (c.error) {
                  throw new Error(c.error);
                } c.warnings && c.warnings.length && A(c.warnings, G);
              } return this;
            } }, { key: '_argsHasAnyUserData', value(a) {
              const b = a.userData != null && B(a.userData).length > 0; a = a.userDataFormFields != null && B(a.userDataFormFields).length > 0; return b || a;
            } }, { key: 'fire', value(a) {
              const c = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : !1; this._validateSend(a, c); if (this._argsHasAnyUserData(a) && !this.fbq.loadPlugin('identity') || this.locks.isLocked()) {
                g.fbq('fire', a); return this;
              } const d = a.customParameters; let e = ''; d && d.es && typeof d.es === 'string' && (e = d.es); a.customData = a.customData || {}; const f = this.fbq.getEventCustomParameters(this.getPixel(a.pixelId), a.eventName, a.customData, e, a.eventData); b(a.eventData, a.customData || {}, f, a.pixelId); d && A(B(d), (a) => {
                if (f.containsKey(a)) {
                  throw new Error('Custom parameter '.concat(a, ' already specified.'));
                } f.append(a, d[a]);
              }); t({ customData: a.customData, customParams: f, eventName: a.eventName, eventData: a.eventData, id: a.pixelId, piiTranslator: null, experimentId: a.experimentId }, this); return this;
            } }, { key: 'callMethod', value(a) {
              const b = a[0]; a = Array.prototype.slice.call(a, 1); if (typeof b !== 'string') {
                G({ type: 'FBQ_NO_METHOD_NAME' }); return;
              } if (typeof this[b] === 'function') {
                try {
                  this[b].apply(this, a);
                } catch (a) {
                  F(a);
                }
              } else {
                G({ method: b, type: 'INVALID_FBQ_METHOD' });
              }
            } }, { key: 'getDefaultSendData', value(a, b, c, d) {
              const e = this.getPixel(a); c = { eventData: c || {}, eventName: b, pixelId: a, experimentId: d }; e && (e.userData && (c.userData = e.userData), e.agent != null && e.agent !== '' ? c.set = { agent: e.agent } : this.fbq.agent != null && this.fbq.agent !== '' && (c.set = { agent: this.fbq.agent })); return c;
            } }, { key: 'getOptedInPixels', value(a) {
              const b = this; return this.optIns.listPixelIds(a).map((a) => {
                return b.pixelsByID[a];
              });
            } }, { key: 'getPixel', value(a) {
              return this.pixelsByID[a];
            } }, { key: 'loadConfig', value(a) {
              if (this.fbq.disableConfigLoading === !0 || Object.prototype.hasOwnProperty.call(this.configsLoaded, a)) {
                return;
              } this.locks.lockConfig(a); if (!this.fbq.pendingConfigs || E(this.fbq.pendingConfigs, (b) => {
                return b === a;
              }) === !1) {
                let b = i.href; let c = h.referrer; b = p(b, c, { google: !0 }); c = o(b); b = ''; c != null && (b = c.hostname); Q(a, this.VERSION, this.RELEASE_SEGMENT != null ? this.RELEASE_SEGMENT : 'stable', b, this.fbq._no_min);
              }
            } }, { key: 'configLoaded', value(a) {
              const b = this; this.configsLoaded[a] = !0; e.trigger(a); this.locks.releaseConfig(a); a !== K && (u(this), this.disableAsyncParamBackupTimeout || setTimeout(() => {
                x(b);
              }, L));
            } }]);
          }()); k.exports = n;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('signalsFBEventsFeatureGate', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsConfigStore'); function b(a, b) {
            return isNaN(b) ? !1 : c(a, b.toString());
          } function c(b, c) {
            c = a.get(c, 'gating'); if (c == null || c.gatings == null) {
              return !1;
            } c = c.gatings.find((a) => {
              return a != null && a.name === b;
            }); return c != null && c.passed === !0;
          }k.exports = b;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('signalsFBEventsFillParamList', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsParamList'); const b = f.getFbeventsModules('SignalsFBEventsQE'); const c = f.getFbeventsModules('SignalsFBEventsQEV2'); let d = f.getFbeventsModules('SignalsFBEventsLogging'); const e = d.logError; d = f.getFbeventsModules('SignalsFBEventsUtils'); d.each; const j = g.top !== g; function l(d) {
            let f = d.customData; const k = d.customParams; const l = d.eventName; const m = d.id; let n = d.piiTranslator; let o = d.documentLink; let p = d.referrerLink; const q = d.timestamp; const r = d.experimentId; f = f != null ? v({}, f) : null; let s = i.href; Object.prototype.hasOwnProperty.call(d, 'documentLink') ? s = o : d.documentLink = s; o = h.referrer; Object.prototype.hasOwnProperty.call(d, 'referrerLink') ? o = p : d.referrerLink = o; p = new a(n); p.append('id', m); p.append('ev', l); p.append('dl', s); p.append('rl', o); p.append('if', j); p.append('ts', q); p.append('cd', f); p.append('sw', g.screen.width); p.append('sh', g.screen.height); k && p.addRange(k); d = b.get(); d != null && p.append('exp', b.getCode(m)); c.isInTest('event_level_no_op_experiment', r); if (r != null) {
              n = c.getExperimentResultParams(r); n != null && n.length > 0 && p.append('expv2', n);
            } else {
              e('expid is null');
            } return p;
          }k.exports = l;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsFilterProtectedModeEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); f.getFbeventsModules('SignalsFBEventsPixelTypedef'); let b = f.getFbeventsModules('SignalsFBEventsTyped'); b = b.Typed; const c = f.getFbeventsModules('SignalsFBEventsMessageParamsTypedef'); a = new a(b.tuple([c])); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsFiredEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); const b = f.getFbeventsModules('SignalsParamList'); function c(a, c) {
            let d = null; (a === 'GET' || a === 'POST' || a === 'BEACON') && (d = a); a = c instanceof b ? c : null; return d != null && a != null ? [d, a] : null;
          }a = new a(c); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('signalsFBEventsFireEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsLogging'); const b = a.logInfo; a = f.getFbeventsModules('SignalsFBEventsEvents'); const c = a.fired; const d = f.getFbeventsModules('SignalsFBEventsQE'); a = f.getFbeventsModules('SignalsFBEventsExperimentNames'); const e = a.NO_OP_EXPERIMENT; const g = f.getFbeventsModules('signalsFBEventsSendBeacon'); const h = f.getFbeventsModules('signalsFBEventsSendGET'); const i = f.getFbeventsModules('signalsFBEventsSendFormPOST'); const j = f.getFbeventsModules('SignalsFBEventsForkEvent'); const l = f.getFbeventsModules('SignalsFBEventsGetTimingsEvent'); const m = f.getFbeventsModules('signalsFBEventsGetIsChrome'); const n = f.getFbeventsModules('signalsFBEventsFillParamList'); const o = 'SubscribedButtonClick'; function p(a) {
            j.trigger(a); const f = a.eventName; a.id === '568414510204424' && b(new Error('Event fired for pixel 568414510204424'), 'pixel', a.eventName); a = n(a); l.trigger(a); const k = !m(); d.isInTest(e); if (k && f === o && g(a)) {
              c.trigger('BEACON', a); return;
            } if (h(a)) {
              c.trigger('GET', a); return;
            } if (k && g(a)) {
              c.trigger('BEACON', a); return;
            }i(a); c.trigger('POST', a);
          }k.exports = p;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsFireLock', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function (a) {
          'use strict'; let b = f.getFbeventsModules('SignalsFBEventsUtils'); const c = b.each; const d = b.keys; b = (function () {
            function a() {
              w(this, a), z(this, '_locks', {}), z(this, '_callbacks', []);
            } return y(a, [{ key: 'lock', value(a) {
              this._locks[a] = !0;
            } }, { key: 'release', value(a) {
              Object.prototype.hasOwnProperty.call(this._locks, a) && (delete this._locks[a], d(this._locks).length === 0 && c(this._callbacks, (b) => {
                return b(a);
              }));
            } }, { key: 'onUnlocked', value(a) {
              this._callbacks.push(a);
            } }, { key: 'isLocked', value() {
              return d(this._locks).length > 0;
            } }, { key: 'lockPlugin', value(a) {
              this.lock('plugin:'.concat(a));
            } }, { key: 'releasePlugin', value(a) {
              this.release('plugin:'.concat(a));
            } }, { key: 'lockConfig', value(a) {
              this.lock('config:'.concat(a));
            } }, { key: 'releaseConfig', value(a) {
              this.release('config:'.concat(a));
            } }, { key: 'lockConsent', value() {
              this.lock('consent');
            } }, { key: 'unlockConsent', value() {
              this.release('consent');
            } }]);
          }()); a = b; z(b, 'global', new a()); k.exports = b;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsForkEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); const b = f.getFbeventsModules('SignalsParamList'); f.getFbeventsModules('SignalsFBEventsPixelTypedef'); let c = f.getFbeventsModules('SignalsFBEventsTyped'); const d = c.Typed; c.coerce; c = d.objectWithFields({ customData: d.allowNull(d.object()), customParams(a) {
            return a instanceof b ? a : void 0;
          }, eventName: d.string(), id: d.string(), piiTranslator(a) {
            return typeof a === 'function' ? a : void 0;
          }, documentLink: d.allowNull(d.string()), referrerLink: d.allowNull(d.string()) }); a = new a(d.tuple([c])); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsGatingConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); a.coerce; a = a.Typed; a = a.objectWithFields({ gatings: a.arrayOf(a.allowNull(a.objectWithFields({ name: a.allowNull(a.string()), passed: a.allowNull(a.boolean()) }))) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsGetAutomaticParametersEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); let b = f.getFbeventsModules('SignalsFBEventsTyped'); const c = b.Typed; const d = b.coerce; function e(a, b) {
            a = d(a, c.string()); b = d(b, c.string()); return a != null && b != null ? [a, b] : null;
          }b = new a(e); k.exports = b;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsGetCustomParametersEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); const b = f.getFbeventsModules('SignalsFBEventsPixelTypedef'); let c = f.getFbeventsModules('SignalsFBEventsTyped'); const d = c.Typed; const e = c.coerce; function g(a, c, f, g, h) {
            a = e(a, b); c = e(c, d.string()); let i = {}; f != null && J(f) === 'object' && (i = f); f = g != null && typeof g === 'string' ? g : null; g = {}; h != null && J(h) === 'object' && (g = h); return a != null && c != null ? [a, c, i, f, g] : null;
          }c = new a(g); k.exports = c;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('signalsFBEventsGetIsChrome', () => {
      return (function (f, g, h, i) {
        const j = { exports: {} }; j.exports; (function () {
          'use strict'; function a() {
            const a = f.chrome; let b = f.navigator; const c = b.vendor; const d = f.opr !== void 0; const e = b.userAgent.includes('Edg'); b = b.userAgent.match('CriOS'); return !b && a !== null && a !== void 0 && c === 'Google Inc.' && d === !1 && e === !1;
          }j.exports = a;
        })(); return j.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('signalsFBEventsGetIsIosInAppBrowser', () => {
      return (function (f, g, h, i) {
        const j = { exports: {} }; j.exports; (function () {
          'use strict'; function a() {
            let a = f.navigator; const b = a.userAgent.indexOf('AppleWebKit'); const c = a.userAgent.indexOf('FBIOS'); const d = a.userAgent.indexOf('Instagram'); a = a.userAgent.indexOf('MessengerLiteForiOS'); return b !== null && (c != -1 || d != -1 || a != -1);
          } function b(b) {
            return a();
          }j.exports = b;
        })(); return j.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsGetIWLParametersEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); const b = f.getFbeventsModules('SignalsConvertNodeToHTMLElement'); const c = f.getFbeventsModules('SignalsFBEventsPixelTypedef'); const d = f.getFbeventsModules('SignalsFBEventsTyped'); const e = d.coerce; function g() {
            for (var a = arguments.length, d = new Array(a), f = 0; f < a; f++) {
              d[f] = arguments[f];
            } const g = d[0]; if (g == null || J(g) !== 'object') {
              return null;
            } const h = g.unsafePixel; const i = g.unsafeTarget; const j = e(h, c); const k = i instanceof Node ? b(i) : null; return j != null && k != null ? [{ pixel: j, target: k }] : null;
          }k.exports = new a(g);
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsGetTimingsEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); const b = f.getFbeventsModules('SignalsParamList'); function c(a) {
            a = a instanceof b ? a : null; return a != null ? [a] : null;
          }a = new a(c); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsGetValidUrl', () => {
      return (function (f, g, h, i) {
        const j = { exports: {} }; j.exports; (function () {
          'use strict'; j.exports = function (a) {
            if (a == null) {
              return null;
            } try {
              a = new URL(a); return a;
            } catch (a) {
              return null;
            }
          };
        })(); return j.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsGuardrail', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsGuardrailTypedef'); f.getFbeventsModules('SignalsFBEventsExperimentsTypedef'); f.getFbeventsModules('SignalsFBEventsLegacyExperimentGroupsTypedef'); f.getFbeventsModules('SignalsFBEventsTypeVersioning'); let b = f.getFbeventsModules('SignalsFBEventsTyped'); const c = b.coerce; b = f.getFbeventsModules('SignalsFBEventsUtils'); b.reduce; const d = function () {
            return Math.random();
          }; const e = {}; function g(a) {
            const b = a.passRate; a.name; b != null && (a.passed = d() < b);
          }b = (function () {
            function b() {
              w(this, b);
            } return y(b, [{ key: 'setGuardrails', value(b) {
              b = c(b, a); if (b != null) {
                this._guardrails = b; b = G(this._guardrails); let d; try {
                  for (b.s(); !(d = b.n()).done;) {
                    d = d.value; if (d.name != null) {
                      const f = d.name; let g = { passed: null }; g = v(v({}, g), d); e[f] = g;
                    }
                  }
                } catch (a) {
                  b.e(a);
                } finally {
                  b.f();
                }
              }
            } }, { key: 'eval', value(a, b) {
              a = e[a]; if (!a) {
                return !1;
              } if (a.enableForPixels && a.enableForPixels.includes(b)) {
                return !0;
              } if (a.passed != null) {
                return a.passed;
              } g(a); return a.passed != null ? a.passed : !1;
            } }, { key: 'enable', value(a) {
              let b = e[a]; if (b != null) {
                b.passed = !0;
              } else {
                b = { passed: !0 }; e[a] = b;
              }
            } }, { key: 'disable', value(a) {
              let b = e[a]; if (b != null) {
                b.passed = !1;
              } else {
                b = { passed: !1 }; e[a] = b;
              }
            } }]);
          }()); k.exports = new b();
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsGuardrailTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); const b = a.Typed; a.coerce; a.enforce; a = b.arrayOf(b.objectWithFields({ name: b.allowNull(b.string()), passRate: b.allowNull(b.number()), enableForPixels: b.allowNull(b.arrayOf(b.string())), code: b.allowNull(b.string()), passed: b.allowNull(b.boolean()) })); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsIABPCMAEBridgeConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); const b = a.Typed; a.coerce; a = b.objectWithFields({ enableAutoEventId: b.allowNull(b.boolean()) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsImagePixelOpenBridgeConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); a = a.Typed; a = a.objectWithFields({ enabled: a.boolean() }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('signalsFBEventsInjectMethod', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('signalsFBEventsMakeSafe'); function b(b, c, d) {
            const e = b[c]; const f = a(d); b[c] = function () {
              for (var a = arguments.length, b = new Array(a), c = 0; c < a; c++) {
                b[c] = arguments[c];
              } const d = e.apply(this, b); f.apply(this, b); return d;
            };
          }k.exports = b;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('signalsFBEventsIsHostMeta', () => {
      return (function (f, g, h, i) {
        const j = { exports: {} }; j.exports; (function () {
          'use strict'; j.exports = function (a) {
            if (typeof a !== 'string') {
              return !1;
            } a = a.match(/^(.*\.)*(meta\.com)\.?$/i); return a !== null;
          };
        })(); return j.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('signalsFBEventsIsURLFromMeta', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('signalsFBEventsIsHostMeta'); function b(a) {
            if (typeof a !== 'string' || a === '') {
              return null;
            } try {
              a = new URL(a); return a.hostname;
            } catch (a) {
              return null;
            }
          } function c(c, d) {
            c = b(c); d = b(d); c = c != null && a(c); d = d != null && a(d); return c || d;
          }k.exports = c;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsIWLBootStrapEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); const b = f.getFbeventsModules('signalsFBEventsCoercePixelID'); function c() {
            for (var a = arguments.length, c = new Array(a), d = 0; d < a; d++) {
              c[d] = arguments[d];
            } const e = c[0]; if (e == null || J(e) !== 'object') {
              return null;
            } const f = e.graphToken; const g = e.pixelID; const h = b(g); return f != null && typeof f === 'string' && h != null ? [{ graphToken: f, pixelID: h }] : null;
          }a = new a(c); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsJSLoader', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsUtils'); const b = a.stringStartsWith; const c = f.getFbeventsModules('SignalsFBEventsGuardrail'); const d = { CDN_BASE_URL: 'https://connect.facebook.net/', SGW_INSTANCE_FRL: 'https://gw.conversionsapigateway.com' }; function e() {
            const a = h.getElementsByTagName('script'); for (let b = 0; b < a.length; b++) {
              const c = a[b]; if (c && c.src && c.src.includes(d.CDN_BASE_URL)) {
                return c;
              }
            } return null;
          } const i = j(); function j() {
            try {
              if (g.trustedTypes && g.trustedTypes.createPolicy) {
                const a = g.trustedTypes; const e = c.eval('use_string_prefix_match_from_util'); return a.createPolicy('connect.facebook.net/fbevents', { createScriptURL(a) {
                  const c = e ? b(a, d.CDN_BASE_URL) : a.startsWith(d.CDN_BASE_URL); const f = e ? b(a, d.SGW_INSTANCE_FRL) : a.startsWith(d.SGW_INSTANCE_FRL); if (!c && !f) {
                    throw new Error('Disallowed script URL');
                  } return a;
                } });
              }
            } catch (a) {} return null;
          } function l(a) {
            const b = h.createElement('script'); i != null ? b.src = i.createScriptURL(a) : b.src = a; b.async = !0; a = e(); a && a.parentNode ? a.parentNode.insertBefore(b, a) : h.head && h.head.firstChild && h.head.appendChild(b);
          }k.exports = { CONFIG: d, loadJSFile: l };
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsLateValidateCustomParametersEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); let b = f.getFbeventsModules('SignalsFBEventsTyped'); const c = b.coerce; const d = b.Typed; f.getFbeventsModules('SignalsFBEventsPixelTypedef'); b = f.getFbeventsModules('SignalsFBEventsCoercePrimitives'); b.coerceString; function e() {
            for (var a = arguments.length, b = new Array(a), e = 0; e < a; e++) {
              b[e] = arguments[e];
            } return c(b, d.tuple([d.string(), d.object(), d.string()]));
          }b = new a(e); k.exports = b;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsLegacyExperimentGroupsTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); const b = a.Typed; a.coerce; const c = a.enforce; a = f.getFbeventsModules('SignalsFBEventsTypeVersioning'); a = a.upgrade; function d(a) {
            return a != null && J(a) === 'object' ? Object.values(a) : null;
          } const e = function (a) {
            a = Array.isArray(a) ? a : d(a); return c(a, b.arrayOf(b.objectWithFields({ code: b.string(), name: b.string(), passRate: b.number(), range: b.tuple([b.number(), b.number()]) })));
          }; function g(a) {
            const b = a.name; const c = a.code; const d = a.range; a = a.passRate; return { allocation: d[1] - d[0], code: c, name: b, passRate: a };
          }k.exports = a(e, (a) => {
            return a.map(g);
          });
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsLogging', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('signalsFBEventsIsURLFromMeta'); let b = f.getFbeventsModules('SignalsFBEventsUtils'); const c = b.isArray; const d = b.isInstanceOf; const e = b.map; const i = f.getFbeventsModules('SignalsParamList'); const j = f.getFbeventsModules('signalsFBEventsSendGET'); const l = f.getFbeventsModules('SignalsFBEventsJSLoader'); let m = !1; function n() {
            m = !0;
          } let o = !0; function p() {
            o = !1;
          } let q = !1; function r() {
            q = !0;
          } const s = 'console'; const t = 'warn'; const u = []; function v(a) {
            g[s] && g[s][t] && (g[s][t](a), q && u.push(a));
          } let w = !1; function x() {
            w = !0;
          } function y(a) {
            if (w) {
              return;
            } v('[Meta Pixel] - '.concat(a));
          } const z = 'Meta Pixel Error'; const A = function () {
            g.postMessage != null && g.postMessage.apply(g, arguments);
          }; const B = {}; function C(a) {
            switch (a.type) {
              case 'FBQ_NO_METHOD_NAME':return 'You must provide an argument to fbq().'; case 'INVALID_FBQ_METHOD':var b = a.method; return '"fbq(\''.concat(b, '\', ...);" is not a valid fbq command.'); case 'INVALID_FBQ_METHOD_PARAMETER':b = a.invalidParamName; var c = a.invalidParamValue; var d = a.method; var e = a.params; return 'Call to "fbq(\''.concat(d, '\', ').concat(E(e), ');" with parameter "').concat(b, '" has an invalid value of "').concat(D(c), '"'); case 'INVALID_PIXEL_ID':d = a.pixelID; return 'Invalid PixelID: '.concat(d, '.'); case 'DUPLICATE_PIXEL_ID':e = a.pixelID; return 'Duplicate Pixel ID: '.concat(e, '.'); case 'SET_METADATA_ON_UNINITIALIZED_PIXEL_ID':b = a.metadataValue; c = a.pixelID; return 'Trying to set argument '.concat(b, ' for uninitialized Pixel ID ').concat(c, '.'); case 'CONFLICTING_VERSIONS':return 'Multiple pixels with conflicting versions were detected on this page.'; case 'MULTIPLE_PIXELS':return 'Multiple pixels were detected on this page.'; case 'UNSUPPORTED_METADATA_ARGUMENT':d = a.metadata; return 'Unsupported metadata argument: '.concat(d, '.'); case 'REQUIRED_PARAM_MISSING':e = a.param; b = a.eventName; return 'Required parameter \''.concat(e, '\' is missing for event \'').concat(b, '\'.'); case 'INVALID_PARAM':c = a.param; d = a.eventName; return 'Parameter \''.concat(c, '\' is invalid for event \'').concat(d, '\'.'); case 'NO_EVENT_NAME':return 'Missing event name. Track events must be logged with an event name fbq("track", eventName)'; case 'NO_EVENT_ID':e = a.pixelID; return 'got null or empty eventID from 4th parameter for Pixel ID: '.concat(e, '.'); case 'INVALID_EVENT_ID_FORMAT':b = a.pixelID; c = a.eventName; return 'Incorrect eventID type. The eventID parameter needs to be a string for Pixel ID: '.concat(b, ' for event \'').concat(c); case 'NONSTANDARD_EVENT':d = a.eventName; return `${'You are sending a non-standard event \''.concat(d, '\'. ')}The preferred way to send these events is using trackCustom. See 'https://developers.facebook.com/docs/ads-for-websites/pixel-events/#events' for more information.`; case 'NEGATIVE_EVENT_PARAM':e = a.param; b = a.eventName; return 'Parameter \''.concat(e, '\' is negative for event \'').concat(b, '\'.'); case 'PII_INVALID_TYPE':c = a.key_type; d = a.key_val; return 'An invalid '.concat(c, ' was specified for \'').concat(d, '\'. This data will not be sent with any events for this Pixel.'); case 'PII_UNHASHED_PII':e = a.key; return 'The value for the \''.concat(e, '\' key appeared to be PII. This data will not be sent with any events for this Pixel.'); case 'INVALID_CONSENT_ACTION':b = a.action; return '"fbq(\''.concat(b, '\', ...);" is not a valid fbq(\'consent\', ...) action. Valid actions are \'revoke\' and \'grant\'.'); case 'INVALID_JSON_LD':c = a.jsonLd; return 'Unable to parse JSON-LD tag. Malformed JSON found: \''.concat(c, '\'.'); case 'SITE_CODELESS_OPT_OUT':d = a.pixelID; return 'Unable to open Codeless events interface for pixel as the site has opted out. Pixel ID: '.concat(d, '.'); case 'PIXEL_NOT_INITIALIZED':e = a.pixelID; return 'Pixel '.concat(e, ' not found'); case 'UNWANTED_CUSTOM_DATA':return 'Removed parameters from custom data due to potential violations. Go to Events Manager to learn more.'; case 'UNWANTED_URL_DATA':return 'Removed URL query parameters due to potential violations.'; case 'UNWANTED_EVENT_NAME':return 'Blocked Event due to potential violations.'; case 'UNVERIFIED_EVENT':return 'You are attempting to send an unverified event. The event was suppressed. Go to Events Manager to learn more.'; case 'RESTRICTED_EVENT':return 'You are attempting to send a restricted event. The event was suppressed. Go to Events Manager to learn more.'; case 'INVALID_PARAM_FORMAT':b = a.invalidParamName; return 'Invalid parameter format for '.concat(b, '. Please refer https://developers.facebook.com/docs/meta-pixel/reference/ for valid parameter specifications.'); default:L(new Error('INVALID_USER_ERROR - '.concat(a.type, ' - ').concat(JSON.stringify(a)))); return 'Invalid User Error.';
            }
          } var D = function (a) {
            if (typeof a === 'string') {
              return '\''.concat(a, '\'');
            } else if (typeof a == 'undefined') {
              return 'undefined';
            } else if (a === null) {
              return 'null';
            } else if (!c(a) && a.constructor != null && a.constructor.name != null) {
              return a.constructor.name;
            } try {
              return JSON.stringify(a) || 'undefined';
            } catch (a) {
              return 'undefined';
            }
          }; var E = function (a) {
            return e(a, D).join(', ');
          }; function F(a) {
            const b = a.toString(); let c = null; let e = null; d(a, Error) && (c = a.fileName, e = a.stackTrace || a.stack); return { str: b, fileName: c, stack: e };
          } function G() {
            const a = g.fbq.instance.pluginConfig.get(null, 'dataProcessingOptions'); return a != null && a.dataPrivacyOptions.includes('LDU') ? !0 : !1;
          } function H() {
            return g.fbq && g.fbq._releaseSegment ? g.fbq._releaseSegment : 'unknown';
          } function I() {
            const b = Math.random(); const c = H(); return o && b < 0.01 || c === 'canary' || a(g.location.href, h.referrer) || g.fbq.alwaysLogErrors;
          } function J(a, b, c, d, e) {
            try {
              if (G()) {
                return;
              } if (g.fbq && g.fbq.disableErrorLogging) {
                return;
              } if (!I()) {
                return;
              } const f = new i(null); d != null && d !== '' ? f.append('p', d) : f.append('p', 'pixel'); e != null && e !== '' && f.append('pn', e); f.append('sl', c.toString()); f.append('v', g.fbq && g.fbq.version ? g.fbq.version : 'unknown'); f.append('e', a.str); a.fileName != null && a.fileName !== '' && f.append('f', a.fileName); a.stack != null && a.stack !== '' && f.append('s', a.stack); f.append('ue', b ? '1' : '0'); f.append('rs', H()); j(f, { url: `${l.CONFIG.CDN_BASE_URL}/log/error`, ignoreRequestLengthCheck: !0 });
            } catch (a) {}
          } function K(a) {
            let b = JSON.stringify(a); if (!Object.prototype.hasOwnProperty.call(B, b)) {
              B[b] = !0;
            } else {
              return;
            }b = C(a); y(b); const c = 'pixelID' in a && a.pixelID != null ? a.pixelID : null; A({ action: 'FB_LOG', logMessage: b, logType: z, error: a, pixelId: c, url: g.location.href }, '*'); J({ str: b, fileName: null, stack: null }, !0, 0);
          } function L(a, b, c) {
            if (a instanceof TypeError) {
              M(a); return;
            }J(F(a), !1, 0, b, c); m && y(a.toString());
          } function M(a, b, c) {
            J(F(a), !1, 1, b, c), m && y(a.toString());
          } function N(a, b, c) {
            J(F(a), !1, 2, b, c), m && y(a.toString());
          } function O(a, b, c) {
            J({ str: a, fileName: null, stack: null }, !1, 2, b, c), m && y(a);
          }b = { consoleWarn: v, disableAllLogging: x, disableSampling: p, enableVerboseDebugLogging: n, logError: L, logUserError: K, logWarning: M, logInfoString: O, logInfo: N, enableBufferedLoggedWarnings: r, bufferedLoggedWarnings: u }; k.exports = b;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('signalsFBEventsMakeSafe', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsLogging'); const b = a.logError; function c(a) {
            return function () {
              try {
                for (var c = arguments.length, d = new Array(c), e = 0; e < c; e++) {
                  d[e] = arguments[e];
                }a.apply(this, d);
              } catch (a) {
                b(a);
              }
            };
          }k.exports = c;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsMessageParamsTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); a = a.Typed; const b = f.getFbeventsModules('SignalsParamList'); a = a.objectWithFields({ customData: a.allowNull(a.object()), customParams(a) {
            return a instanceof b ? a : void 0;
          }, eventName: a.string(), id: a.string(), piiTranslator(a) {
            return typeof a === 'function' ? a : void 0;
          }, documentLink: a.allowNull(a.string()), referrerLink: a.allowNull(a.string()) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsMicrodataConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); a = a.Typed; a = a.objectWithFields({ waitTimeMs: a.allowNull(a.withValidation({ def: a.number(), validators: [function (a) {
            return a > 0 && a < 1e4;
          }] })), enablePageHash: a.allowNull(a.boolean()) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsMobileAppBridge', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsTelemetry'); const b = f.getFbeventsModules('SignalsFBEventsUtils'); const c = b.each; const d = 'fbmq-0.1'; const e = { AddPaymentInfo: 'fb_mobile_add_payment_info', AddToCart: 'fb_mobile_add_to_cart', AddToWishlist: 'fb_mobile_add_to_wishlist', CompleteRegistration: 'fb_mobile_complete_registration', InitiateCheckout: 'fb_mobile_initiated_checkout', Other: 'other', Purchase: 'fb_mobile_purchase', Search: 'fb_mobile_search', ViewContent: 'fb_mobile_content_view' }; const h = { content_ids: 'fb_content_id', content_type: 'fb_content_type', currency: 'fb_currency', num_items: 'fb_num_items', search_string: 'fb_search_string', value: '_valueToSum', contents: 'fb_content' }; const i = {}; function j(a) {
            return `fbmq_${a[1]}`;
          } function l(a) {
            if (Object.prototype.hasOwnProperty.call(i, [0]) && Object.prototype.hasOwnProperty.call(i[a[0]], a[1])) {
              return !0;
            } let b = g[j(a)]; b = b && b.getProtocol.call && b.getProtocol() === d ? b : null; b !== null && (i[a[0]] = i[a[0]] || {}, i[a[0]][a[1]] = b); return b !== null;
          } function m(a) {
            const b = []; a = i[a.id] || {}; for (const c in a) {
              Object.prototype.hasOwnProperty.call(a, c) && b.push(a[c]);
            } return b;
          } function n(a) {
            return m(a).length > 0;
          } function o(a) {
            return Object.prototype.hasOwnProperty.call(e, a) ? e[a] : a;
          } function p(a) {
            return Object.prototype.hasOwnProperty.call(h, a) ? h[a] : a;
          } function q(a) {
            if (typeof a === 'string') {
              return a;
            } if (typeof a === 'number') {
              return isNaN(a) ? void 0 : a;
            } try {
              return JSON.stringify(a);
            } catch (a) {} return a.toString && a.toString.call ? a.toString() : void 0;
          } function r(a) {
            const b = {}; if (a != null && J(a) === 'object') {
              for (const c in a) {
                if (Object.prototype.hasOwnProperty.call(a, c)) {
                  const d = q(a[c]); d != null && (b[p(c)] = d);
                }
              }
            } return b;
          } let s = 0; function t() {
            const b = s; s = 0; a.logMobileNativeForwarding(b);
          } function u(a, b, d) {
            c(m(a), (c) => {
              return c.sendEvent(a.id, o(b), JSON.stringify(r(d)));
            }), s++, setTimeout(t, 0);
          }k.exports = { pixelHasActiveBridge: n, registerBridge: l, sendEvent: u };
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsModuleEncodings', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); const b = a.coerce; const c = f.getFbeventsModules('SignalsFBEventsModuleEncodingsTypedef'); f.getFbeventsModules('SignalsParamList'); a = f.getFbeventsModules('SignalsFBEventsTyped'); const d = a.Typed; a = f.getFbeventsModules('SignalsFBEventsUtils'); const h = a.map; const i = a.keys; const j = a.filter; f.getFbeventsModules('SignalsFBEventsQE'); f.getFbeventsModules('SignalsFBEventsGuardrail'); a = (function () {
            function a() {
              w(this, a);
            } return y(a, [{ key: 'setModuleEncodings', value(a) {
              a = b(a, c); a != null && (this.moduleEncodings = a);
            } }, { key: 'addEncodings', value(a) {
              const c = this; if (g.fbq == null || g.fbq.__fbeventsResolvedModules == null) {
                return;
              } if (this.moduleEncodings == null) {
                return;
              } let f = b(g.fbq.__fbeventsResolvedModules, d.object()); if (f == null) {
                return;
              } f = j(h(i(f), (a) => {
                return c.moduleEncodings.map != null && a in c.moduleEncodings.map ? c.moduleEncodings.map[a] : null;
              }), (a) => {
                return a != null;
              }); f.length > 0 && (this.moduleEncodings.hash != null && a.append('hme', this.moduleEncodings.hash), a.append('ex_m', f.join(',')));
            } }]);
          }()); k.exports = new a();
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsModuleEncodingsTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); a = a.Typed; a = a.objectWithFields({ map: a.allowNull(a.object()), hash: a.allowNull(a.string()) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsNetworkConfig', () => {
      return (function (f, g, h, i) {
        const j = { exports: {} }; j.exports; (function () {
          'use strict'; const a = { ENDPOINT: 'https://www.facebook.com/tr/', INSTAGRAM_TRIGGER_ATTRIBUTION: 'https://www.instagram.com/tr/', GPS_ENDPOINT: 'https://www.facebook.com/privacy_sandbox/pixel/register/trigger/', TOPICS_API_ENDPOINT: 'https://www.facebook.com/privacy_sandbox/topics/registration/' }; j.exports = a;
        })(); return j.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsNormalizers', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('normalizeSignalsFBEventsStringType'); const b = a.normalize; const c = a.normalizeState; a = a.normalizeCountry; k.exports = { email: f.getFbeventsModules('normalizeSignalsFBEventsEmailType'), enum: f.getFbeventsModules('normalizeSignalsFBEventsEnumType'), postal_code: f.getFbeventsModules('normalizeSignalsFBEventsPostalCodeType'), phone_number: f.getFbeventsModules('normalizeSignalsFBEventsPhoneNumberType'), dob: f.getFbeventsModules('normalizeSignalsFBEventsDOBType'), normalize_state: c, normalize_country: a, string: b };
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsOpenBridgeConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); const b = a.Typed; a.coerce; a = b.objectWithFields({ endpoints: b.arrayOf(b.objectWithFields({ targetDomain: b.allowNull(b.string()), endpoint: b.allowNull(b.string()), usePathCookie: b.allowNull(b.boolean()), fallbackDomain: b.allowNull(b.string()), enrichmentDisabled: b.allowNull(b.boolean()) })), eventsFilter: b.allowNull(b.objectWithFields({ filteringMode: b.allowNull(b.string()), eventNames: b.allowNull(b.arrayOf(b.string())) })), additionalUserData: b.allowNull(b.objectWithFields({ sendFBLoginID: b.allowNull(b.boolean()), useSGWUserData: b.allowNull(b.boolean()) })), blockedWebsites: b.allowNull(b.arrayOf(b.string())) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsOptIn', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsUtils'); const b = a.each; const c = a.filter; const d = a.keys; const e = a.some; function g(a) {
            b(d(a), (b) => {
              if (e(a[b], (b) => {
                return Object.prototype.hasOwnProperty.call(a, b);
              })) {
                throw new Error(`Circular subOpts are not allowed. ${b} depends on another subOpt`);
              }
            });
          }a = (function () {
            function a() {
              const b = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {}; w(this, a); z(this, '_opts', {}); this._subOpts = b; g(this._subOpts);
            } return y(a, [{ key: '_getOpts', value(a) {
              return [].concat(C(Object.prototype.hasOwnProperty.call(this._subOpts, a) ? this._subOpts[a] : []), [a]);
            } }, { key: '_setOpt', value(a, b, c) {
              b = this._opts[b] || (this._opts[b] = {}); b[a] = c;
            } }, { key: 'optIn', value(a, c) {
              const d = this; const e = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : !1; b(this._getOpts(c), (b) => {
                const f = e == !0 && d.isOptedOut(a, c); f || d._setOpt(a, b, !0);
              }); return this;
            } }, { key: 'optOut', value(a, c) {
              const d = this; b(this._getOpts(c), (b) => {
                return d._setOpt(a, b, !1);
              }); return this;
            } }, { key: 'isOptedIn', value(a, b) {
              return this._opts[b] != null && this._opts[b][a] === !0;
            } }, { key: 'isOptedOut', value(a, b) {
              return this._opts[b] != null && this._opts[b][a] === !1;
            } }, { key: 'listPixelIds', value(a) {
              const b = this._opts[a]; return b != null
                ? c(d(b), (a) => {
                  return b[a] === !0;
                })
                : [];
            } }]);
          }()); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsParallelFireConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); a = a.Typed; a = a.objectWithFields({ target: a.string() }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsPIIAutomatchedEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); const b = f.getFbeventsModules('SignalsFBEventsPixelTypedef'); let c = f.getFbeventsModules('SignalsFBEventsTyped'); const d = c.coerce; function e(a) {
            a = d(a, b); return a != null ? [a] : null;
          }c = new a(e); k.exports = c;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsPIIConflictingEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); const b = f.getFbeventsModules('SignalsFBEventsPixelTypedef'); let c = f.getFbeventsModules('SignalsFBEventsTyped'); const d = c.coerce; function e(a) {
            a = d(a, b); return a != null ? [a] : null;
          }c = new a(e); k.exports = c;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsPIIInvalidatedEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); const b = f.getFbeventsModules('SignalsFBEventsPixelTypedef'); const c = f.getFbeventsModules('SignalsFBEventsTyped'); const d = c.coerce; function e(a) {
            a = d(a, b); return a != null ? [a] : null;
          }k.exports = new a(e);
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsPixelCookie', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsLogging'); const b = a.logError; const c = a.logWarning; const d = 'fb'; const e = 4; const g = 5; const h = ['AQ', 'Ag', 'Aw', 'BA', 'BQ', 'Bg']; const i = 2; const j = 8; const l = '__DOT__'; const m = new RegExp(l, 'g'); const n = /\./g; const o = 'pixel'; const p = 'cookie'; a = (function () {
            function a(b) {
              w(this, a), typeof b === 'string' ? this.maybeUpdatePayload(b) : (this.subdomainIndex = b.subdomainIndex, this.creationTime = b.creationTime, this.payload = b.payload, this.paramBuilderToken = b.paramBuilderToken);
            } return y(a, [{ key: 'pack', value() {
              let a = this.payload != null ? this.payload.replace(n, l) : ''; a = [d, this.subdomainIndex, this.creationTime, a, this.paramBuilderToken].filter((a) => {
                return a != null;
              }); return a.join('.');
            } }, { key: 'maybeUpdatePayload', value(a) {
              if (this.payload === null || this.payload !== a) {
                this.payload = a; a = Date.now(); this.creationTime = typeof a === 'number' ? a : new Date().getTime();
              }
            } }], [{ key: 'unpack', value(f) {
              try {
                f = f.split('.'); if (f.length !== e && f.length !== g) {
                  return null;
                } let k = q(f, 5); let l = k[0]; let n = k[1]; let r = k[2]; const s = k[3]; k = k[4]; if (k != null) {
                  if (k.length !== i && k.length !== j) {
                    throw new Error('Illegal param builder token length');
                  } if (k.length === i && !h.includes(k)) {
                    throw new Error('Illegal param builder token');
                  }
                } if (l !== d) {
                  if (l.includes(d)) {
                    c(new Error('Unexpected version number \''.concat(f[0], '\'')), o, p);
                  } else {
                    throw new Error('Unexpected version number \''.concat(f[0], '\''));
                  }
                }l = Number.parseInt(n, 10); if (isNaN(l)) {
                  throw new TypeError('Illegal subdomain index \''.concat(f[1], '\''));
                } n = Number.parseInt(r, 10); if (isNaN(n)) {
                  throw new TypeError('Illegal creation time \''.concat(f[2], '\''));
                } if (s == null || s === '') {
                  throw new Error('Empty cookie payload');
                } r = s.replace(m, '.'); return new a({ creationTime: n, payload: r, subdomainIndex: l, paramBuilderToken: k });
              } catch (a) {
                b(a, o, p); return null;
              }
            } }]);
          }()); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsPixelPIISchema', () => {
      return (function (f, g, h, i) {
        const j = { exports: {} }; j.exports; (function () {
          'use strict'; j.exports = { default: { type: 'string', typeParams: { lowercase: !0, strip: 'whitespace_only' } }, ph: { type: 'phone_number' }, em: { type: 'email' }, fn: { type: 'string', typeParams: { lowercase: !0, strip: 'whitespace_and_punctuation' } }, ln: { type: 'string', typeParams: { lowercase: !0, strip: 'whitespace_and_punctuation' } }, zp: { type: 'postal_code' }, ct: { type: 'string', typeParams: { lowercase: !0, strip: 'all_non_latin_alpha_numeric', test: '^[a-z]+' } }, st: { type: 'normalize_state' }, country: { type: 'normalize_country' }, db: { type: 'dob' }, dob: { type: 'date' }, doby: { type: 'string', typeParams: { test: '^[0-9]{4,4}$' } }, ge: { type: 'enum', typeParams: { lowercase: !0, options: ['f', 'm'] } }, dobm: { type: 'string', typeParams: { test: '^(0?[1-9]|1[012])$|^jan|^feb|^mar|^apr|^may|^jun|^jul|^aug|^sep|^oct|^nov|^dec' } }, dobd: { type: 'string', typeParams: { test: '^(([0]?[1-9])|([1-2][0-9])|(3[01]))$' } } };
        })(); return j.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsPixelTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); a = a.Typed; a = a.objectWithFields({ eventCount: a.number(), id: a.fbid(), userData: a.mapOf(a.string()), userDataFormFields: a.mapOf(a.string()) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsPlugin', () => {
      return (function (f, g, h, i) {
        const j = { exports: {} }; j.exports; (function () {
          'use strict'; const a = y(function a(b) {
            w(this, a), z(this, '__fbEventsPlugin', 1), this.plugin = b, this.__fbEventsPlugin = 1;
          }); j.exports = a;
        })(); return j.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsPluginLoadedEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); function b(a) {
            a = a != null && typeof a === 'string' ? a : null; return a != null ? [a] : null;
          }k.exports = new a(b);
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsPluginManager', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsConfigStore'); let b = f.getFbeventsModules('SignalsFBEventsEvents'); const c = b.pluginLoaded; const d = f.getFbeventsModules('SignalsFBEventsJSLoader'); b = f.getFbeventsModules('SignalsFBEventsLogging'); const e = b.logWarning; const g = f.getFbeventsModules('SignalsFBEventsPlugin'); function h(a) {
            return 'fbevents.plugins.'.concat(a);
          } function i(a, b) {
            if (a === 'fbevents') {
              return new g(() => {});
            } if (b instanceof g) {
              return b;
            } if (b == null || J(b) !== 'object') {
              e(new Error('Invalid pluginAPI registered '.concat(a))); return new g(() => {});
            } const c = b.__fbEventsPlugin; b = b.plugin; if (c !== 1 || typeof b !== 'function') {
              e(new Error('Invalid plugin registered '.concat(a))); return new g(() => {});
            } return new g(b);
          }b = (function () {
            function b(a, c) {
              w(this, b), z(this, '_loadedPlugins', {}), this._instance = a, this._lock = c;
            } return y(b, [{ key: 'registerPlugin', value(b, d) {
              if (Object.prototype.hasOwnProperty.call(this._loadedPlugins, b)) {
                return;
              } this._loadedPlugins[b] = i(b, d); this._loadedPlugins[b].plugin(f, this._instance, a); c.trigger(b); this._lock.releasePlugin(b);
            } }, { key: 'loadPlugin', value(a) {
              if (/^[a-z]\w+$/i.test(a) === !1) {
                throw new Error('Invalid plugin name: '.concat(a));
              } const b = h(a); if (this._loadedPlugins[b]) {
                return !0;
              } if (f.fbIsModuleLoaded(b)) {
                this.registerPlugin(b, f.getFbeventsModules(b)); return !0;
              }a = ''.concat(d.CONFIG.CDN_BASE_URL, 'signals/plugins/').concat(a, '.js?v=').concat(f.version); if (!this._loadedPlugins[b]) {
                this._lock.lockPlugin(b); d.loadJSFile(a); return !0;
              } return !1;
            } }]);
          }()); k.exports = b;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsProcessCCRulesEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); const b = f.getFbeventsModules('SignalsParamList'); function c(a, c) {
            a = a instanceof b ? a : null; c = J(c) === 'object' ? v({}, c) : null; return a != null ? [a, c] : null;
          }a = new a(c); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsProcessEmailAddress', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsValidationUtils'); const b = a.looksLikeHashed; a = f.getFbeventsModules('SignalsFBEventsLogging'); const c = a.logError; a = f.getFbeventsModules('SignalsFBEventsUtils'); const d = a.each; const e = a.keys; a = f.getFbeventsModules('SignalsFBEventsValidationUtils'); const g = a.trim; f.getFbeventsModules('SignalsFBEventsQE'); const h = ['em', 'email']; function i(a) {
            try {
              if (a == null || J(a) !== 'object') {
                return a;
              } d(e(a), (c) => {
                let d = a[c]; if (b(d)) {
                  return;
                } if (typeof h.includes === 'function' && !h.includes(c) || d == null || typeof d != 'string') {
                  return;
                } d = g(d); if (d.length === 0) {
                  return;
                } d[d.length - 1] === ',' && (d = d.slice(0, d.length - 1)); a[c] = d;
              });
            } catch (a) {
              a.message = `[NormalizeEmailAddress]: ${a.message}`, c(a);
            } return a;
          }k.exports = i;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsProhibitedPixelConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); a.coerce; a = a.Typed; a = a.objectWithFields({ lockWebpage: a.allowNull(a.boolean()), blockReason: a.allowNull(a.string()) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsProhibitedSourcesTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); const b = a.Typed; a.coerce; a = b.objectWithFields({ prohibitedSources: b.arrayOf(b.objectWithFields({ domain: b.allowNull(b.string()) })) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsProtectedDataModeConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); const b = a.Typed; a.coerce; a = b.objectWithFields({ standardParams: b.mapOf(b.boolean()), disableAM: b.allowNull(b.boolean()) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsQE', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsGuardrail'); const b = f.getFbeventsModules('SignalsFBEventsExperimentsTypedef'); const c = f.getFbeventsModules('SignalsFBEventsLegacyExperimentGroupsTypedef'); const d = f.getFbeventsModules('SignalsFBEventsTypeVersioning'); let e = f.getFbeventsModules('SignalsFBEventsTyped'); const g = e.coerce; e = f.getFbeventsModules('SignalsFBEventsUtils'); const h = e.reduce; e = f.getFbeventsModules('SignalsFBEventsLogging'); const i = e.logWarning; const j = function () {
            return Math.random();
          }; const l = 'pixel'; const m = 'FBEventsQE'; function n(a) {
            const b = h(a, (b, c, a) => {
              if (a === 0) {
                b.push([0, c.allocation]); return b;
              }a = q(b[a - 1], 2); a[0]; a = a[1]; b.push([a, a + c.allocation]); return b;
            }, []); const c = j(); for (let d = 0; d < a.length; d++) {
              let e = a[d]; const f = e.passRate; const g = e.code; e = e.name; let i = q(b[d], 2); let k = i[0]; i = i[1]; if (c >= k && c < i) {
                k = j() < f; return { code: g, isInExperimentGroup: k, name: e };
              }
            } return null;
          }e = (function () {
            function e() {
              w(this, e), z(this, '_result', null), z(this, '_hasRolled', !1), z(this, '_isExposed', !1), z(this, 'CONTROL', 'CONTROL'), z(this, 'TEST', 'TEST'), z(this, 'UNASSIGNED', 'UNASSIGNED');
            } return y(e, [{ key: 'setExperiments', value(a) {
              a = g(a, d.waterfall([c, b])); a != null && (this._experiments = a, this._hasRolled = !1, this._result = null, this._isExposed = !1);
            } }, { key: 'get', value(a) {
              if (!this._hasRolled) {
                let b = this._experiments; if (b == null) {
                  return null;
                } b = n(b); b != null && (this._result = b); this._hasRolled = !0;
              } if (a == null || a === '') {
                return this._result;
              } return this._result != null && this._result.name === a ? this._result : null;
            } }, { key: 'getCode', value(a) {
              try {
                if (a != null && a.toString() === '3615875995349958') {
                  return 'm1';
                }
              } catch (b) {
                a = new Error('QE override failed'); i(a, l, m);
              }a = this.get(); if (a == null) {
                return '';
              } let b = 0; a.isInExperimentGroup && (b |= 1); this._isExposed && (b |= 2); return a.code + b.toString();
            } }, { key: 'getAssignmentFor', value(a) {
              const b = this.get(); if (b != null && b.name === a) {
                this._isExposed = !0; return b.isInExperimentGroup ? this.TEST : this.CONTROL;
              } return this.UNASSIGNED;
            } }, { key: 'isInTest', value(b) {
              if (a.eval(`release_${b}`)) {
                return !0;
              } const c = this.get(); if (c != null && c.name === b) {
                this._isExposed = !0; return c.isInExperimentGroup;
              } return !1;
            } }, { key: 'clearExposure', value() {
              this._isExposed = !1;
            } }]);
          }()); k.exports = new e();
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsQEV2', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsExperimentsV2Typedef'); let b = f.getFbeventsModules('SignalsFBEventsTyped'); const c = b.coerce; b = f.getFbeventsModules('SignalsFBEventsUtils'); b.reduce; const d = function () {
            return Math.random();
          }; function e(a) {
            const b = d(); let c = 0; for (let e = 0; e < a.length; e++) {
              let f = a[e]; let g = f.passRate; const h = f.code; const i = f.name; f = f.allocation; f = c + f; if (b >= c && b < f) {
                g = d() < g; return { isExposed: !1, isInTest: g, code: h, name: i };
              }c = f;
            } return null;
          }b = (function () {
            function b() {
              w(this, b), z(this, '_experiments', []), z(this, '_pageLoadLevelEvaluationExperimentResults', new Map()), z(this, '_eventLevelEvaluationExperimentResults', new Map()), z(this, 'PAGE_LOAD_LEVEL', 'PAGE_LOAD_LEVEL'), z(this, 'EVENT_LEVEL', 'EVENT_LEVEL');
            } return y(b, [{ key: 'setExperiments', value(b) {
              b = c(b, a); if (b == null) {
                return;
              } this._experiments = b;
            } }, { key: '_reset', value() {
              this._pageLoadLevelEvaluationExperimentResults.clear(), this._eventLevelEvaluationExperimentResults.clear();
            } }, { key: 'clearExposure', value(a) {
              this._eventLevelEvaluationExperimentResults.has(a) && this._eventLevelEvaluationExperimentResults.delete(a);
            } }, { key: 'isInTest', value(a, b) {
              let c = this._getExperimentByName(a); if (c == null) {
                return !1;
              } c = this._getExperimentResultForUniverse(c.universe, c.evaluationType, b); if (c == null || c.name !== a) {
                return !1;
              } c.isExposed = !0; return c.isInTest;
            } }, { key: 'isInTestPageLoadLevelExperiment', value(a) {
              let b = this._getExperimentByName(a); if (b == null || b.evaluationType != this.PAGE_LOAD_LEVEL) {
                return !1;
              } b = this._getPageLoadLevelExperimentResult(b.universe); if (b == null || b.name !== a) {
                return !1;
              } b.isExposed = !0; return b.isInTest;
            } }, { key: 'getExperimentResultParams', value(a) {
              const b = []; for (let c = 0; c < this._experiments.length; c++) {
                let d = this._experiments[c]; d = this._getExperimentResultForUniverse(d.universe, d.evaluationType, a); if (d == null) {
                  continue;
                } d = this._getParamByResult(d); b.includes(d) || b.push(d);
              } return b;
            } }, { key: '_getParamByResult', value(a) {
              let b = 0; a.isInTest && (b |= 1); a.isExposed && (b |= 2); return a.code + b.toString();
            } }, { key: '_getExperimentResultForUniverse', value(a, b, c) {
              return b === this.PAGE_LOAD_LEVEL ? this._getPageLoadLevelExperimentResult(a) : this._getEventLevelExperimentResult(a, c);
            } }, { key: '_getPageLoadLevelExperimentResult', value(a) {
              if (this._pageLoadLevelEvaluationExperimentResults.has(a)) {
                return this._pageLoadLevelEvaluationExperimentResults.get(a);
              } let b = this._getExperimentsByUniverse(a); b = e(b); this._pageLoadLevelEvaluationExperimentResults.set(a, b); return b;
            } }, { key: '_getEventLevelExperimentResult', value(a, b) {
              if (this._eventLevelEvaluationExperimentResults.has(b)) {
                var c = this._eventLevelEvaluationExperimentResults.get(b); if (c && c.has(a)) {
                  return c.get(a);
                }
              }c = this._getExperimentsByUniverse(a); c = e(c); this._eventLevelEvaluationExperimentResults.has(b) || this._eventLevelEvaluationExperimentResults.set(b, new Map()); b = this._eventLevelEvaluationExperimentResults.get(b); b && b.set(a, c); return c;
            } }, { key: '_getExperimentByName', value(a) {
              for (let b = 0; b < this._experiments.length; b++) {
                const c = this._experiments[b]; if (c.name === a) {
                  return c;
                }
              } return null;
            } }, { key: '_getExperimentsByUniverse', value(a) {
              const b = []; for (let c = 0; c < this._experiments.length; c++) {
                const d = this._experiments[c]; d.universe === a && b.push(d);
              } return b;
            } }]);
          }()); k.exports = new b();
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('signalsFBEventsResolveLegacyArguments', () => {
      return (function (f, g, h, i) {
        const j = { exports: {} }; j.exports; (function () {
          'use strict'; const a = 'report'; function b(a) {
            let b = q(a, 1); b = b[0]; return a.length === 1 && Array.isArray(b) ? { args: b, isLegacySyntax: !0 } : { args: a, isLegacySyntax: !1 };
          } function c(b) {
            let c = q(b, 2); let d = c[0]; c = c[1]; if (typeof d === 'string' && d.slice(0, a.length) === a) {
              d = d.slice(a.length); if (d === 'CustomEvent') {
                c != null && J(c) === 'object' && typeof c.event === 'string' && (d = c.event); return ['trackCustom', d].concat(b.slice(1));
              } return ['track', d].concat(b.slice(1));
            } return b;
          } function d(a) {
            a = b(a); let d = a.args; a = a.isLegacySyntax; d = c(d); return { args: d, isLegacySyntax: a };
          }j.exports = d;
        })(); return j.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsResolveLink', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsGetValidUrl'); const b = f.getFbeventsModules('SignalsFBEventsUtils'); b.each; const c = b.keys; function d(b, d, e) {
            let f = g.top !== g; if (!f) {
              return (b === null || b === void 0 ? void 0 : b.length) > 0 ? b : d;
            } if (!d || d.length === 0) {
              return b;
            } if (e != null) {
              f = a(d); if (!f) {
                return b;
              } const h = f.origin; f = c(e).some((a) => {
                return a != null && h.includes(a);
              }); if (f) {
                return b;
              }
            } return d;
          }k.exports = d;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsRestrictedDomainsConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); const b = a.Typed; a.coerce; a = b.objectWithFields({ restrictedDomains: b.allowNull(b.arrayOf(b.allowNull(b.string()))), blacklistedIframeReferrers: b.allowNull(b.mapOf(b.boolean())) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('signalsFBEventsSendBeacon', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; f.getFbeventsModules('SignalsFBEventsQE'); const a = f.getFbeventsModules('SignalsFBEventsNetworkConfig'); const b = f.getFbeventsModules('SignalsFBEventsLogging'); const c = b.logWarning; function d(b, d) {
            try {
              if (!g.navigator || !g.navigator.sendBeacon) {
                return !1;
              } d = d || {}; d = d.url; d = d === void 0 ? a.ENDPOINT : d; b.replaceEntry('rqm', 'SB'); return g.navigator.sendBeacon(d, b.toFormData());
            } catch (a) {
              a instanceof Error && c(new Error(`[SendBeacon]:${a.message}`)); return !1;
            }
          }k.exports = d;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsSendCloudbridgeEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); f.getFbeventsModules('SignalsFBEventsPixelTypedef'); let b = f.getFbeventsModules('SignalsFBEventsTyped'); b = b.Typed; const c = f.getFbeventsModules('SignalsFBEventsMessageParamsTypedef'); a = new a(b.tuple([c])); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('signalsFBEventsSendEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsEvents'); a.fired; const b = a.setEventId; const c = f.getFbeventsModules('SignalsParamList'); const d = f.getFbeventsModules('SignalsFBEventsProcessCCRulesEvent'); const e = f.getFbeventsModules('SignalsFBEventsLateValidateCustomParametersEvent'); a = f.getFbeventsModules('SignalsFBEventsUtils'); const h = a.each; const i = a.keys; f.getFbeventsModules('SignalsFBEventsNetworkConfig'); const j = f.getFbeventsModules('SignalsFBEventsSetFilteredEventName'); a = f.getFbeventsModules('SignalsFBEventsAsyncParamUtils'); const l = a.appendAsyncParamsAndSendEvent; const m = f.getFbeventsModules('SignalsFBEventsGuardrail'); const n = f.getFbeventsModules('signalsFBEventsFillParamList'); g.top !== g; function o(a, f) {
            a.customData = v({}, a.customData); a.timestamp = new Date().valueOf(); let g = null; a.customParams != null && (g = m.eval('multi_eid_fix') ? a.customParams.getEventId() : a.customParams.get('eid')); if (g == null || g === '') {
              a.customParams = a.customParams || new c(); g = a.customParams; a.id != null && b.trigger(String(a.id), g, a.eventName);
            }g = d.trigger(n(a), a.customData); g != null && h(g, (b) => {
              b != null && h(i(b), (d) => {
                a.customParams = a.customParams || new c(), a.customParams.append(d, b[d]);
              });
            }); g = e.trigger(String(a.id), a.customData || {}, a.eventName); g && h(g, (b) => {
              b && h(i(b), (d) => {
                a.customParams = a.customParams || new c(), a.customParams.append(d, b[d]);
              });
            }); g = j.trigger(n(a)); g != null && h(g, (b) => {
              b != null && h(i(b), (d) => {
                a.customParams = a.customParams || new c(), a.customParams.append(d, b[d]);
              });
            }); f.asyncParamPromisesAllSettled ? l(f, a) : f.eventQueue.push(a);
          }k.exports = { sendEvent: o };
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsSendEventEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); const b = f.getFbeventsModules('SignalsParamList'); f.getFbeventsModules('SignalsFBEventsPixelTypedef'); let c = f.getFbeventsModules('SignalsFBEventsTyped'); const d = c.Typed; c.coerce; c = d.objectWithFields({ customData: d.allowNull(d.object()), customParams(a) {
            return a instanceof b ? a : void 0;
          }, eventName: d.string(), id: d.string(), piiTranslator(a) {
            return typeof a === 'function' ? a : void 0;
          }, documentLink: d.allowNull(d.string()), referrerLink: d.allowNull(d.string()) }); a = new a(d.tuple([c])); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('signalsFBEventsSendEventImpl', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsSendEventEvent'); const b = f.getFbeventsModules('SignalsFBEventsSendCloudbridgeEvent'); const c = f.getFbeventsModules('SignalsFBEventsFilterProtectedModeEvent'); const d = f.getFbeventsModules('SignalsFBEventsGetAutomaticParametersEvent'); let e = f.getFbeventsModules('SignalsFBEventsUtils'); const g = e.some; const j = f.getFbeventsModules('signalsFBEventsFireEvent'); e = f.getFbeventsModules('SignalsFBEventsUtils'); const l = e.each; const m = e.keys; const n = f.getFbeventsModules('SignalsParamList'); const o = f.getFbeventsModules('signalsFBEventsFeatureGate'); e = f.getFbeventsModules('SignalsPixelCookieUtils'); const p = e.writeNewCookie; const q = e.CLICKTHROUGH_COOKIE_PARAM; e.NINETY_DAYS_IN_MS; const r = '_fbleid'; const s = 7 * 24 * 60 * 60 * 1e3; const t = f.getFbeventsModules('generateEventId'); function u(a, b) {
            if (a.id != null && o('offsite_clo_beta_event_id_coverage', a.id) && a.eventName === 'Lead' && a.customParams != null) {
              let c = a.customParams.get(q); const d = a.customParams != null ? a.customParams.get('eid') : null; if (c != null && c.trim() != '') {
                c = d != null ? d : t(b && b.VERSION || 'undefined', 'LCP'); d == null && a.customParams != null && a.customParams.append('eid', c); p(r, c, s);
              }
            }
          } function v(a) {
            const b = d.trigger(String(a.id), a.eventName); b != null && l(b, (b) => {
              b != null && l(m(b), (c) => {
                a.customParams = a.customParams || new n(), a.customParams.append(c, b[c]);
              });
            });
          } function w(a) {
            if (a.customParams != null) {
              let b = a.documentLink; b !== i.href && a.customParams.append('dlc', '1'); b = a.referrerLink; b !== h.referrer && a.customParams.append('rlc', '1');
            }
          } function x(d, e) {
            let f = a.trigger(d); if (g(f, (a) => {
              return a;
            })) {
              return;
            } u(d, e); v(d); c.trigger(d); w(d); f = b.trigger(d); if (g(f, (a) => {
              return a;
            })) {
              return;
            } e = Object.prototype.hasOwnProperty.call(d, 'customData') && typeof d.customData !== 'undefined' && d.customData !== null; e || (d.customData = {}); j(d);
          }k.exports = x;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('signalsFBEventsSendFormPOST', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsNetworkConfig'); let b = f.getFbeventsModules('SignalsFBEventsUtils'); const c = b.listenOnce; b = f.getFbeventsModules('SignalsFBEventsLogging'); const d = b.logError; const e = b.logWarning; const i = f.getFbeventsModules('SignalsFBEventsGuardrail'); function j(b, f) {
            try {
              b.replaceEntry('rqm', 'formPOST'); const j = `fb${Math.random().toString().replace('.', '')}`; const k = h.createElement('form'); k.method = 'post'; k.action = f != null ? f : a.ENDPOINT; k.target = j; k.acceptCharset = 'utf-8'; k.style.display = 'none'; f = !!(g.attachEvent && !g.addEventListener); const l = h.createElement('iframe'); f && (l.name = j); l.src = 'about:blank'; l.id = j; l.name = j; k.appendChild(l); const m = i.eval('fix_fbevent_uri_error'); c(l, 'load', () => {
                b.each((a, c) => {
                  const d = h.createElement('input'); if (m) {
                    try {
                      d.name = decodeURIComponent(a);
                    } catch (c) {
                      d.name = a, b.append('ie[g]', '1'), e(c, 'pixel', 'SendFormPOST');
                    }
                  } else {
                    d.name = decodeURIComponent(a);
                  }d.value = c; k.appendChild(d);
                }), c(l, 'load', () => {
                  k.parentNode && k.parentNode.removeChild(k);
                }), k.submit();
              }); h.body != null && h.body.appendChild(k); return !0;
            } catch (a) {
              a instanceof Error && d(new Error(`[POST]:${a.message}`)); return !0;
            }
          }k.exports = j;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('signalsFBEventsSendGET', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsNetworkConfig'); const b = f.getFbeventsModules('SignalsFBEventsShouldRestrictReferrerEvent'); const c = f.getFbeventsModules('SignalsFBEventsUtils'); const d = c.some; const e = 2048; function g(c, f) {
            try {
              let g = f || {}; let h = g.ignoreRequestLengthCheck; h = h === void 0 ? !1 : h; let i = g.url; i = i === void 0 ? a.ENDPOINT : i; g = g.attributionReporting; g = g === void 0 ? !1 : g; c.replaceEntry('rqm', h ? 'FGET' : 'GET'); let j = c.toQueryString(); i = `${i}?${j}`; if (h || i.length < e) {
                j = new Image(); f != null && f.errorHandler != null && (j.onerror = f.errorHandler); h = b.trigger(c); d(h, (a) => {
                  return a;
                }) && (j.referrerPolicy = 'origin'); g && j.setAttribute('attributionsrc', ''); j.src = i; return !0;
              } return !1;
            } catch (a) {
              return !1;
            }
          }k.exports = g;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsSetCCRules', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); let b = f.getFbeventsModules('SignalsFBEventsUtils'); b.filter; b.map; b = f.getFbeventsModules('SignalsFBEventsTyped'); const c = b.coerce; b = b.Typed; f.getFbeventsModules('signalsFBEventsCoerceParameterExtractors'); const d = f.getFbeventsModules('signalsFBEventsCoercePixelID'); const e = b.arrayOf(b.objectWithFields({ id: b.number(), rule: b.string() })); function g() {
            for (var a = arguments.length, b = new Array(a), f = 0; f < a; f++) {
              b[f] = arguments[f];
            } const g = b[0]; if (g == null || J(g) !== 'object') {
              return null;
            } const h = g.pixelID; const i = g.rules; const j = d(h); if (j == null) {
              return null;
            } const k = c(i, e); return [{ rules: k, pixelID: j }];
          }b = new a(g); k.exports = b;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsSetESTRules', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); let b = f.getFbeventsModules('SignalsFBEventsUtils'); b.filter; b.map; b = f.getFbeventsModules('SignalsFBEventsTyped'); const c = b.coerce; b = b.Typed; f.getFbeventsModules('signalsFBEventsCoerceParameterExtractors'); const d = f.getFbeventsModules('signalsFBEventsCoercePixelID'); const e = b.arrayOf(b.objectWithFields({ condition: b.objectOrString(), derived_event_name: b.string(), rule_status: b.allowNull(b.string()), transformations: b.allowNull(b.array()), rule_id: b.allowNull(b.string()) })); function g() {
            for (var a = arguments.length, b = new Array(a), f = 0; f < a; f++) {
              b[f] = arguments[f];
            } const g = b[0]; if (g == null || J(g) !== 'object') {
              return null;
            } const h = g.pixelID; const i = g.rules; const j = d(h); if (j == null) {
              return null;
            } const k = c(i, e); return [{ rules: k, pixelID: j }];
          }b = new a(g); k.exports = b;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsSetEventIDEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); const b = f.getFbeventsModules('SignalsParamList'); f.getFbeventsModules('SignalsFBEventsPixelTypedef'); let c = f.getFbeventsModules('SignalsFBEventsTyped'); const d = c.coerce; const e = f.getFbeventsModules('signalsFBEventsCoercePixelID'); function g(a, c, f) {
            a = e(a); c = c instanceof b ? c : null; f = d(f, String); return a != null && c != null && f != null ? [a, c, f] : null;
          }c = new a(g); k.exports = c;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsSetFilteredEventName', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); const b = f.getFbeventsModules('SignalsParamList'); f.getFbeventsModules('SignalsFBEventsPixelTypedef'); let c = f.getFbeventsModules('SignalsFBEventsTyped'); c.Typed; c.coerce; function d(a) {
            a = a instanceof b ? a : null; return a != null ? [a] : null;
          }c = new a(d); k.exports = c;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsSetIWLExtractorsEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); let b = f.getFbeventsModules('SignalsFBEventsUtils'); const c = b.filter; const d = b.map; const e = f.getFbeventsModules('signalsFBEventsCoerceParameterExtractors'); const g = f.getFbeventsModules('signalsFBEventsCoercePixelID'); function h() {
            for (var a = arguments.length, b = new Array(a), f = 0; f < a; f++) {
              b[f] = arguments[f];
            } const h = b[0]; if (h == null || J(h) !== 'object') {
              return null;
            } const i = h.pixelID; const j = h.extractors; const k = g(i); const l = Array.isArray(j) ? d(j, e) : null; const m = l != null ? c(l, Boolean) : null; return m != null && l != null && m.length === l.length && k != null ? [{ extractors: m, pixelID: k }] : null;
          }b = new a(h); k.exports = b;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsShared', () => {
      return (function (f, g, h, i) {
        const j = { exports: {} }; j.exports; (function () {
          j.exports = (function (a) {
            const b = {}; function c(d) {
              if (b[d]) {
                return b[d].exports;
              } const e = b[d] = { i: d, l: !1, exports: {} }; return a[d].call(e.exports, e, e.exports, c), e.l = !0, e.exports;
            } return c.m = a, c.c = b, c.d = function (a, b, d) {
              c.o(a, b) || Object.defineProperty(a, b, { enumerable: !0, get: d });
            }, c.r = function (a) {
              typeof Symbol != 'undefined' && (typeof Symbol === 'function' ? Symbol.toStringTag : '@@toStringTag') && Object.defineProperty(a, typeof Symbol === 'function' ? Symbol.toStringTag : '@@toStringTag', { value: 'Module' }), Object.defineProperty(a, '__esModule', { value: !0 });
            }, c.t = function (a, b) {
              if (1 & b && (a = c(a)), 8 & b) {
                return a;
              } if (4 & b && J(a) == 'object' && a && a.__esModule) {
                return a;
              } const d = Object.create(null); if (c.r(d), Object.defineProperty(d, 'default', { enumerable: !0, value: a }), 2 & b && typeof a != 'string') {
                for (b in a) {
                  c.d(d, b, ((b) => {
                    return a[b];
                  }).bind(null, b));
                }
              } return d;
            }, c.n = function (a) {
              const b = a && a.__esModule
                ? function () {
                  return a.default;
                }
                : function () {
                  return a;
                }; return c.d(b, 'a', b), b;
            }, c.o = function (a, b) {
              return Object.prototype.hasOwnProperty.call(a, b);
            }, c.p = '', c(c.s = 76);
          }([function (a, b, c) {
            'use strict'; a.exports = c(79);
          }, function (a, b, c) {
            'use strict'; a.exports = function (a) {
              if (a != null) {
                return a;
              } throw new Error('Got unexpected null or undefined');
            };
          }, function (a, b, c) {
            'use strict'; a.exports = c(133);
          }, function (a, b, c) {
            'use strict'; b = c(53); const d = b.all; a.exports = b.IS_HTMLDDA
              ? function (a) {
                return typeof a == 'function' || a === d;
              }
              : function (a) {
                return typeof a == 'function';
              };
          }, function (a, b, c) {
            'use strict'; a.exports = c(98);
          }, function (a, b, c) {
            'use strict'; a.exports = function (a) {
              try {
                return !!a();
              } catch (a) {
                return !0;
              }
            };
          }, function (a, b, c) {
            'use strict'; b = c(8); const d = c(59); const e = c(14); const f = c(60); const g = c(57); c = c(56); const h = b.Symbol; const i = d('wks'); const j = c ? h.for || h : h && h.withoutSetter || f; a.exports = function (a) {
              return e(i, a) || (i[a] = g && e(h, a) ? h[a] : j(`Symbol.${a}`)), i[a];
            };
          }, function (a, b, c) {
            'use strict'; b = c(25); c = Function.prototype; const d = c.call; c = b && c.bind.bind(d, d); a.exports = b
              ? c
              : function (a) {
                return function () {
                  return d.apply(a, arguments);
                };
              };
          }, function (a, b, c) {
            'use strict'; (function (b) {
              const c = function (a) {
                return a && a.Math === Math && a;
              }; a.exports = c((typeof globalThis === 'undefined' ? 'undefined' : J(globalThis)) == 'object' && globalThis) || c(J(f) == 'object' && f) || c((typeof self === 'undefined' ? 'undefined' : J(self)) == 'object' && self) || c(J(b) == 'object' && b) || (function () {
                return this;
              }()) || this || Function('return this')();
            }).call(this, c(84));
          }, function (a, b, c) {
            'use strict'; a.exports = c(138);
          }, function (a, b, c) {
            'use strict'; const d = c(8); const e = c(85); const f = c(26); const g = c(3); const h = c(54).f; const i = c(92); const j = c(40); const k = c(44); const l = c(23); const m = c(14); const n = function (a) {
              const b = function (c, d, f) {
                if (this instanceof b) {
                  switch (arguments.length) {
                    case 0:return new a(); case 1:return new a(c); case 2:return new a(c, d);
                  } return new a(c, d, f);
                } return e(a, this, arguments);
              }; return b.prototype = a.prototype, b;
            }; a.exports = function (a, b) {
              let c; let e; let o; let p; let q; let r; const s = a.target; const t = a.global; const u = a.stat; const v = a.proto; const w = t ? d : u ? d[s] : (d[s] || {}).prototype; const x = t ? j : j[s] || l(j, s, {})[s]; const y = x.prototype; for (o in b) {
                e = !(c = i(t ? o : s + (u ? '.' : '#') + o, a.forced)) && w && m(w, o), p = x[o], e && (q = a.dontCallGetSet ? (r = h(w, o)) && r.value : w[o]), r = e && q ? q : b[o], e && J(p) == J(r) || (e = a.bind && e ? k(r, d) : a.wrap && e ? n(r) : v && g(r) ? f(r) : r, (a.sham || r && r.sham || p && p.sham) && l(e, 'sham', !0), l(x, o, e), v && (m(j, p = `${s}Prototype`) || l(j, p, {}), l(j[p], o, r), a.real && y && (c || !y[o]) && l(y, o, r)));
              }
            };
          }, function (a, b, c) {
            'use strict'; const d = c(77); a.exports = function a(b, c) {
              return !(!b || !c) && (b === c || !d(b) && (d(c) ? a(b, c.parentNode) : 'contains' in b ? b.contains(c) : !!b.compareDocumentPosition && !!(16 & b.compareDocumentPosition(c))));
            };
          }, function (a, b, c) {
            'use strict'; a.exports = c(128);
          }, function (a, b, c) {
            'use strict'; const d = c(3); b = c(53); const e = b.all; a.exports = b.IS_HTMLDDA
              ? function (a) {
                return J(a) == 'object' ? a !== null : d(a) || a === e;
              }
              : function (a) {
                return J(a) == 'object' ? a !== null : d(a);
              };
          }, function (a, b, c) {
            'use strict'; b = c(7); const d = c(22); const e = b({}.hasOwnProperty); a.exports = Object.hasOwn || function (a, b) {
              return e(d(a), b);
            };
          }, function (a, b, c) {
            'use strict'; b = c(5); a.exports = !b(() => {
              return Object.defineProperty({}, 1, { get() {
                return 7;
              } })[1] !== 7;
            });
          }, function (a, b, c) {
            'use strict'; b = c(25); const d = Function.prototype.call; a.exports = b
              ? d.bind(d)
              : function () {
                return d.apply(d, arguments);
              };
          }, function (a, b, c) {
            'use strict'; const d = c(13); const e = String; const f = TypeError; a.exports = function (a) {
              if (d(a)) {
                return a;
              } throw f(`${e(a)} is not an object`);
            };
          }, function (a, b, c) {
            'use strict'; b = c(30); a.exports = b;
          }, function (a, b, c) {
            'use strict'; a.exports = c(158);
          }, function (a, b, c) {
            'use strict'; b = c(7); const d = b({}.toString); const e = b(''.slice); a.exports = function (a) {
              return e(d(a), 8, -1);
            };
          }, function (a, b, c) {
            'use strict'; const d = c(3); const e = c(58); const f = TypeError; a.exports = function (a) {
              if (d(a)) {
                return a;
              } throw f(`${e(a)} is not a function`);
            };
          }, function (a, b, c) {
            'use strict'; const d = c(29); const e = Object; a.exports = function (a) {
              return e(d(a));
            };
          }, function (a, b, c) {
            'use strict'; b = c(15); const d = c(32); const e = c(27); a.exports = b
              ? function (a, b, c) {
                return d.f(a, b, e(1, c));
              }
              : function (a, b, c) {
                return a[b] = c, a;
              };
          }, function (a, b, c) {
            'use strict'; a.exports = c(145);
          }, function (a, b, c) {
            'use strict'; b = c(5); a.exports = !b(() => {
              const a = function () {}.bind(); return typeof a != 'function' || Object.prototype.hasOwnProperty.call(a, 'prototype');
            });
          }, function (a, b, c) {
            'use strict'; const d = c(20); const e = c(7); a.exports = function (a) {
              if (d(a) === 'Function') {
                return e(a);
              }
            };
          }, function (a, b, c) {
            'use strict'; a.exports = function (a, b) {
              return { enumerable: !(1 & a), configurable: !(2 & a), writable: !(4 & a), value: b };
            };
          }, function (a, b, c) {
            'use strict'; const d = c(37); const e = c(29); a.exports = function (a) {
              return d(e(a));
            };
          }, function (a, b, c) {
            'use strict'; const d = c(38); const e = TypeError; a.exports = function (a) {
              if (d(a)) {
                throw e(`Can't call method on ${a}`);
              } return a;
            };
          }, function (a, b, c) {
            'use strict'; const d = c(40); const e = c(8); const f = c(3); const g = function (a) {
              return f(a) ? a : void 0;
            }; a.exports = function (a, b) {
              return arguments.length < 2 ? g(d[a]) || g(e[a]) : d[a] && d[a][b] || e[a] && e[a][b];
            };
          }, function (a, b, c) {
            'use strict'; a.exports = !0;
          }, function (a, b, c) {
            'use strict'; a = c(15); const d = c(61); const e = c(63); const f = c(17); const g = c(39); const h = TypeError; const i = Object.defineProperty; const j = Object.getOwnPropertyDescriptor; b.f = a
              ? e
                ? function (a, b, c) {
                  if (f(a), b = g(b), f(c), typeof a == 'function' && b === 'prototype' && 'value' in c && 'writable' in c && !c.writable) {
                    const d = j(a, b); d && d.writable && (a[b] = c.value, c = { configurable: 'configurable' in c ? c.configurable : d.configurable, enumerable: 'enumerable' in c ? c.enumerable : d.enumerable, writable: !1 });
                  } return i(a, b, c);
                }
                : i
              : function (a, b, c) {
                if (f(a), b = g(b), f(c), d) {
                  try {
                    return i(a, b, c);
                  } catch (a) {}
                } if ('get' in c || 'set' in c) {
                  throw h('Accessors not supported');
                } return 'value' in c && (a[b] = c.value), a;
              };
          }, function (a, b, c) {
            'use strict'; const d = c(64); a.exports = function (a) {
              return d(a.length);
            };
          }, function (a, b, c) {
            'use strict'; b = c(47); const d = c(3); const e = c(20); const f = c(6)('toStringTag'); const g = Object; const h = e(function () {
              return arguments;
            }()) === 'Arguments'; a.exports = b
              ? e
              : function (a) {
                let b; return void 0 === a
                  ? 'Undefined'
                  : a === null
                    ? 'Null'
                    : typeof (b = (function (a, b) {
                      try {
                        return a[b];
                      } catch (a) {}
                    }(a = g(a), f))) == 'string'
                      ? b
                      : h ? e(a) : (b = e(a)) === 'Object' && d(a.callee) ? 'Arguments' : b;
              };
          }, function (a, b, c) {
            'use strict'; a.exports = {};
          }, function (a, b, c) {
            'use strict'; a.exports = function (a) {
              const b = []; return (function a(b, c) {
                let d = b.length; let e = 0; for (;d--;) {
                  const f = b[e++]; Array.isArray(f) ? a(f, c) : c.push(f);
                }
              }(a, b)), b;
            };
          }, function (a, b, c) {
            'use strict'; b = c(7); const d = c(5); const e = c(20); const f = Object; const g = b(''.split); a.exports = d(() => {
              return !f('z').propertyIsEnumerable(0);
            })
              ? function (a) {
                return e(a) === 'String' ? g(a, '') : f(a);
              }
              : f;
          }, function (a, b, c) {
            'use strict'; a.exports = function (a) {
              return a == null;
            };
          }, function (a, b, c) {
            'use strict'; const d = c(87); const e = c(55); a.exports = function (a) {
              a = d(a, 'string'); return e(a) ? a : `${a}`;
            };
          }, function (a, b, c) {
            'use strict'; a.exports = {};
          }, function (a, b, c) {
            'use strict'; let d, e; b = c(8); c = c(89); let f = b.process; b = b.Deno; f = f && f.versions || b && b.version; b = f && f.v8; b && (e = (d = b.split('.'))[0] > 0 && d[0] < 4 ? 1 : +(d[0] + d[1])), !e && c && (!(d = c.match(/Edge\/(\d+)/)) || d[1] >= 74) && (d = c.match(/Chrome\/(\d+)/)) && (e = +d[1]), a.exports = e;
          }, function (a, b, c) {
            'use strict'; const d = c(21); const e = c(38); a.exports = function (a, b) {
              a = a[b]; return e(a) ? void 0 : d(a);
            };
          }, function (a, b, c) {
            'use strict'; b = c(8); c = c(91); b = b['__core-js_shared__'] || c('__core-js_shared__', {}); a.exports = b;
          }, function (a, b, c) {
            'use strict'; b = c(26); const d = c(21); const e = c(25); const f = b(b.bind); a.exports = function (a, b) {
              return d(a), void 0 === b
                ? a
                : e
                  ? f(a, b)
                  : function () {
                    return a.apply(b, arguments);
                  };
            };
          }, function (a, b, c) {
            'use strict'; const d = c(44); b = c(7); const e = c(37); const f = c(22); const g = c(33); const h = c(94); const i = b([].push); c = function (a) {
              const b = a === 1; const c = a === 2; const j = a === 3; const k = a === 4; const l = a === 6; const m = a === 7; const n = a === 5 || l; return function (o, p, q, r) {
                for (var s, t, u = f(o), v = e(u), p = d(p, q), q = g(v), w = 0, r = r || h, r = b ? r(o, q) : c || m ? r(o, 0) : void 0; q > w; w++) {
                  if ((n || w in v) && (t = p(s = v[w], w, u), a)) {
                    if (b) {
                      r[w] = t;
                    } else if (t) {
                      switch (a) {
                        case 3:return !0; case 5:return s; case 6:return w; case 2:i(r, s);
                      }
                    } else {
                      switch (a) {
                        case 4:return !1; case 7:i(r, s);
                      }
                    }
                  }
                } return l ? -1 : j || k ? k : r;
              };
            }; a.exports = { forEach: c(0), map: c(1), filter: c(2), some: c(3), every: c(4), find: c(5), findIndex: c(6), filterReject: c(7) };
          }, function (a, b, c) {
            'use strict'; const d = c(93); a.exports = function (a) {
              a = +a; return a != a || a === 0 ? 0 : d(a);
            };
          }, function (a, b, c) {
            'use strict'; b = {}; b[c(6)('toStringTag')] = 'z', a.exports = String(b) === '[object z]';
          }, function (a, b, c) {
            'use strict'; const d = c(34); const e = String; a.exports = function (a) {
              if (d(a) === 'Symbol') {
                throw new TypeError('Cannot convert a Symbol value to a string');
              } return e(a);
            };
          }, function (a, b, c) {
            'use strict'; b = c(59); const d = c(60); const e = b('keys'); a.exports = function (a) {
              return e[a] || (e[a] = d(a));
            };
          }, function (a, b, c) {
            'use strict'; a.exports = {};
          }, function (a, b, c) {
            'use strict'; const d = c(28); const e = c(112); const f = c(33); b = function (a) {
              return function (b, c, g) {
                let h; b = d(b); const i = f(b); g = e(g, i); if (a && c != c) {
                  for (;i > g;) {
                    if ((h = b[g++]) != h) {
                      return !0;
                    }
                  }
                } else {
                  for (;i > g; g++) {
                    if ((a || g in b) && b[g] === c) {
                      return a || g || 0;
                    }
                  }
                } return !a && -1;
              };
            }; a.exports = { includes: b(!0), indexOf: b(!1) };
          }, function (a, b, c) {
            'use strict'; a.exports = c(153);
          }, function (a, b, c) {
            'use strict'; b = J(g) == 'object' && g.all; c = void 0 === b && void 0 !== b; a.exports = { all: b, IS_HTMLDDA: c };
          }, function (a, b, c) {
            'use strict'; a = c(15); const d = c(16); const e = c(86); const f = c(27); const g = c(28); const h = c(39); const i = c(14); const j = c(61); const k = Object.getOwnPropertyDescriptor; b.f = a
              ? k
              : function (a, b) {
                if (a = g(a), b = h(b), j) {
                  try {
                    return k(a, b);
                  } catch (a) {}
                } if (i(a, b)) {
                  return f(!d(e.f, a, b), a[b]);
                }
              };
          }, function (a, b, c) {
            'use strict'; const d = c(30); const e = c(3); const f = c(88); b = c(56); const g = Object; a.exports = b
              ? function (a) {
                return J(a) == 'symbol';
              }
              : function (a) {
                const b = d('Symbol'); return e(b) && f(b.prototype, g(a));
              };
          }, function (a, b, c) {
            'use strict'; b = c(57); a.exports = b && !(typeof Symbol === 'function' ? Symbol.sham : '@@sham') && J(typeof Symbol === 'function' ? Symbol.iterator : '@@iterator') == 'symbol';
          }, function (a, b, c) {
            'use strict'; const d = c(41); b = c(5); const e = c(8).String; a.exports = !!Object.getOwnPropertySymbols && !b(() => {
              const a = Symbol('symbol detection'); return !e(a) || !(Object(a) instanceof Symbol) || !(typeof Symbol === 'function' ? Symbol.sham : '@@sham') && d && d < 41;
            });
          }, function (a, b, c) {
            'use strict'; const d = String; a.exports = function (a) {
              try {
                return d(a);
              } catch (a) {
                return 'Object';
              }
            };
          }, function (a, b, c) {
            'use strict'; b = c(31); const d = c(43); (a.exports = function (a, b) {
              return d[a] || (d[a] = void 0 !== b ? b : {});
            })('versions', []).push({ version: '3.32.2', mode: b ? 'pure' : 'global', copyright: '\xA9 2014-2023 Denis Pushkarev (zloirock.ru)', license: 'https://github.com/zloirock/core-js/blob/v3.32.2/LICENSE', source: 'https://github.com/zloirock/core-js' });
          }, function (a, b, c) {
            'use strict'; b = c(7); let d = 0; const e = Math.random(); const f = b(1.0.toString); a.exports = function (a) {
              return `Symbol(${void 0 === a ? '' : a})_${f(++d + e, 36)}`;
            };
          }, function (a, b, c) {
            'use strict'; b = c(15); const d = c(5); const e = c(62); a.exports = !b && !d(() => {
              return Object.defineProperty(e('div'), 'a', { get() {
                return 7;
              } }).a !== 7;
            });
          }, function (a, b, c) {
            'use strict'; b = c(8); c = c(13); const d = b.document; const e = c(d) && c(d.createElement); a.exports = function (a) {
              return e ? d.createElement(a) : {};
            };
          }, function (a, b, c) {
            'use strict'; b = c(15); c = c(5); a.exports = b && c(() => {
              return Object.defineProperty(() => {}, 'prototype', { value: 42, writable: !1 }).prototype !== 42;
            });
          }, function (a, b, c) {
            'use strict'; const d = c(46); const e = Math.min; a.exports = function (a) {
              return a > 0 ? e(d(a), 9007199254740991) : 0;
            };
          }, function (a, b, c) {
            'use strict'; b = c(7); const d = c(5); const e = c(3); const f = c(34); const g = c(30); const h = c(97); const i = function () {}; const j = []; const k = g('Reflect', 'construct'); const l = /^\s*(?:class|function)\b/; const m = b(l.exec); const n = !l.exec(i); const o = function (a) {
              if (!e(a)) {
                return !1;
              } try {
                return k(i, j, a), !0;
              } catch (a) {
                return !1;
              }
            }; c = function (a) {
              if (!e(a)) {
                return !1;
              } switch (f(a)) {
                case 'AsyncFunction':case 'GeneratorFunction':case 'AsyncGeneratorFunction':return !1;
              } try {
                return n || !!m(l, h(a));
              } catch (a) {
                return !0;
              }
            }; c.sham = !0, a.exports = !k || d(() => {
              let a; return o(o.call) || !o(Object) || !o(() => {
                a = !0;
              }) || a;
            })
              ? c
              : o;
          }, function (a, b, c) {
            'use strict'; const d = c(5); b = c(6); const e = c(41); const f = b('species'); a.exports = function (a) {
              return e >= 51 || !d(() => {
                const b = []; return (b.constructor = {})[f] = function () {
                  return { foo: 1 };
                }, b[a](Boolean).foo !== 1;
              });
            };
          }, function (a, b, c) {
            'use strict'; let d, e; b = c(5); const f = c(3); const g = c(13); const h = c(68); let i = c(70); const j = c(71); let k = c(6); c = c(31); const l = k('iterator'); k = !1; [].keys && ('next' in (e = [].keys()) ? (i = i(i(e))) !== Object.prototype && (d = i) : k = !0), !g(d) || b(() => {
              const a = {}; return d[l].call(a) !== a;
            })
              ? d = {}
              : c && (d = h(d)), f(d[l]) || j(d, l, function () {
              return this;
            }), a.exports = { IteratorPrototype: d, BUGGY_SAFARI_ITERATORS: k };
          }, function (a, b, c) {
            'use strict'; let d; const e = c(17); const f = c(109); const h = c(69); b = c(50); const i = c(113); const j = c(62); c = c(49); const k = c('IE_PROTO'); const l = function () {}; const m = function (a) {
              return `<script>${a}</script>`;
            }; const n = function (a) {
              a.write(m('')), a.close(); const b = a.parentWindow.Object; return a = null, b;
            }; let o = function () {
              try {
                d = new ActiveXObject('htmlfile');
              } catch (a) {} let a; o = typeof g != 'undefined' ? g.domain && d ? n(d) : ((a = j('iframe')).style.display = 'none', i.appendChild(a), a.src = String('javascript:'), (a = a.contentWindow.document).open(), a.write(m('document.F=Object')), a.close(), a.F) : n(d); for (a = h.length; a--;) {
                delete o.prototype[h[a]];
              } return o();
            }; b[k] = !0, a.exports = Object.create || function (a, b) {
              let c; return a !== null ? (l.prototype = e(a), c = new l(), l.prototype = null, c[k] = a) : c = o(), void 0 === b ? c : f.f(c, b);
            };
          }, function (a, b, c) {
            'use strict'; a.exports = ['constructor', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', 'toString', 'valueOf'];
          }, function (a, b, c) {
            'use strict'; const d = c(14); const e = c(3); const f = c(22); b = c(49); c = c(114); const g = b('IE_PROTO'); const h = Object; const i = h.prototype; a.exports = c
              ? h.getPrototypeOf
              : function (a) {
                a = f(a); if (d(a, g)) {
                  return a[g];
                } const b = a.constructor; return e(b) && a instanceof b ? b.prototype : a instanceof h ? i : null;
              };
          }, function (a, b, c) {
            'use strict'; const d = c(23); a.exports = function (a, b, c, e) {
              return e && e.enumerable ? a[b] = c : d(a, b, c), a;
            };
          }, function (a, b, c) {
            'use strict'; const d = c(47); const e = c(32).f; const f = c(23); const g = c(14); const h = c(115); const i = c(6)('toStringTag'); a.exports = function (a, b, c, j) {
              if (a) {
                c = c ? a : a.prototype; g(c, i) || e(c, i, { configurable: !0, value: b }), j && !d && f(c, 'toString', h);
              }
            };
          }, function (a, b, c) {
            'use strict'; const d = c(34); const e = c(42); const f = c(38); const g = c(35); const h = c(6)('iterator'); a.exports = function (a) {
              if (!f(a)) {
                return e(a, h) || e(a, '@@iterator') || g[d(a)];
              }
            };
          }, function (a, b, c) {
            'use strict'; a.exports = function () {};
          }, function (a, b, c) {
            'use strict'; const d = c(5); a.exports = function (a, b) {
              const c = [][a]; return !!c && d(() => {
                c.call(null, b || (() => {
                  return 1;
                }), 1);
              });
            };
          }, function (a, b, c) {
            a.exports = c(163);
          }, function (a, b, c) {
            'use strict'; const d = c(78); a.exports = function (a) {
              return d(a) && a.nodeType == 3;
            };
          }, function (a, b, c) {
            'use strict'; a.exports = function (a) {
              const b = (a ? a.ownerDocument || a : g).defaultView || f; return !(!a || !(typeof b.Node == 'function' ? a instanceof b.Node : J(a) == 'object' && typeof a.nodeType == 'number' && typeof a.nodeName == 'string'));
            };
          }, function (a, b, c) {
            'use strict'; b = c(80); a.exports = b;
          }, function (a, b, c) {
            'use strict'; b = c(81); a.exports = b;
          }, function (a, b, c) {
            'use strict'; b = c(82); a.exports = b;
          }, function (a, b, c) {
            'use strict'; c(83); b = c(18); a.exports = b('Array', 'map');
          }, function (a, b, c) {
            'use strict'; a = c(10); const d = c(45).map; a({ target: 'Array', proto: !0, forced: !c(66)('map') }, { map(a) {
              return d(this, a, arguments.length > 1 ? arguments[1] : void 0);
            } });
          }, function (a, b) {
            b = (function () {
              return this;
            }()); try {
              b = b || new Function('return this')();
            } catch (a) {
              J(f) == 'object' && (b = f);
            }a.exports = b;
          }, function (a, b, c) {
            'use strict'; b = c(25); c = Function.prototype; const d = c.apply; const e = c.call; a.exports = (typeof Reflect === 'undefined' ? 'undefined' : J(Reflect)) == 'object' && Reflect.apply || (b
              ? e.bind(d)
              : function () {
                return e.apply(d, arguments);
              });
          }, function (a, b, c) {
            'use strict'; a = {}.propertyIsEnumerable; const d = Object.getOwnPropertyDescriptor; c = d && !a.call({ 1: 2 }, 1); b.f = c
              ? function (a) {
                a = d(this, a); return !!a && a.enumerable;
              }
              : a;
          }, function (a, b, c) {
            'use strict'; const d = c(16); const e = c(13); const f = c(55); const g = c(42); const h = c(90); b = c(6); const i = TypeError; const j = b('toPrimitive'); a.exports = function (a, b) {
              if (!e(a) || f(a)) {
                return a;
              } let c = g(a, j); if (c) {
                if (void 0 === b && (b = 'default'), c = d(c, a, b), !e(c) || f(c)) {
                  return c;
                } throw i('Can\'t convert object to primitive value');
              } return void 0 === b && (b = 'number'), h(a, b);
            };
          }, function (a, b, c) {
            'use strict'; b = c(7); a.exports = b({}.isPrototypeOf);
          }, function (a, b, c) {
            'use strict'; a.exports = typeof navigator != 'undefined' && String(navigator.userAgent) || '';
          }, function (a, b, c) {
            'use strict'; const d = c(16); const e = c(3); const f = c(13); const g = TypeError; a.exports = function (a, b) {
              let c, h; if (b === 'string' && e(c = a.toString) && !f(h = d(c, a))) {
                return h;
              } if (e(c = a.valueOf) && !f(h = d(c, a))) {
                return h;
              } if (b !== 'string' && e(c = a.toString) && !f(h = d(c, a))) {
                return h;
              } throw g('Can\'t convert object to primitive value');
            };
          }, function (a, b, c) {
            'use strict'; const d = c(8); const e = Object.defineProperty; a.exports = function (a, b) {
              try {
                e(d, a, { value: b, configurable: !0, writable: !0 });
              } catch (c) {
                d[a] = b;
              } return b;
            };
          }, function (a, b, c) {
            'use strict'; const d = c(5); const e = c(3); const f = /#|\.prototype\./; b = function (a, b) {
              a = h[g(a)]; return a === j || a !== i && (e(b) ? d(b) : !!b);
            }; var g = b.normalize = function (a) {
              return String(a).replace(f, '.').toLowerCase();
            }; var h = b.data = {}; var i = b.NATIVE = 'N'; var j = b.POLYFILL = 'P'; a.exports = b;
          }, function (a, b, c) {
            'use strict'; const d = Math.ceil; const e = Math.floor; a.exports = Math.trunc || function (a) {
              a = +a; return (a > 0 ? e : d)(a);
            };
          }, function (a, b, c) {
            'use strict'; const d = c(95); a.exports = function (a, b) {
              return new (d(a))(b === 0 ? 0 : b);
            };
          }, function (a, b, c) {
            'use strict'; const d = c(96); const e = c(65); const f = c(13); const g = c(6)('species'); const h = Array; a.exports = function (a) {
              let b; return d(a) && (b = a.constructor, (e(b) && (b === h || d(b.prototype)) || f(b) && (b = b[g]) === null) && (b = void 0)), void 0 === b ? h : b;
            };
          }, function (a, b, c) {
            'use strict'; const d = c(20); a.exports = Array.isArray || function (a) {
              return d(a) === 'Array';
            };
          }, function (a, b, c) {
            'use strict'; b = c(7); const d = c(3); c = c(43); const e = b(Function.toString); d(c.inspectSource) || (c.inspectSource = function (a) {
              return e(a);
            }), a.exports = c.inspectSource;
          }, function (a, b, c) {
            'use strict'; b = c(99); a.exports = b;
          }, function (a, b, c) {
            'use strict'; b = c(100); a.exports = b;
          }, function (a, b, c) {
            'use strict'; b = c(101); a.exports = b;
          }, function (a, b, c) {
            'use strict'; c(102), c(120); b = c(40); a.exports = b.Array.from;
          }, function (a, b, c) {
            'use strict'; const d = c(103).charAt; const e = c(48); a = c(104); b = c(106); const f = c(119); const g = a.set; const h = a.getterFor('String Iterator'); b(String, 'String', function (a) {
              g(this, { type: 'String Iterator', string: e(a), index: 0 });
            }, function () {
              const a = h(this); let b = a.string; const c = a.index; return c >= b.length ? f(void 0, !0) : (b = d(b, c), a.index += b.length, f(b, !1));
            });
          }, function (a, b, c) {
            'use strict'; b = c(7); const d = c(46); const e = c(48); const f = c(29); const g = b(''.charAt); const h = b(''.charCodeAt); const i = b(''.slice); c = function (a) {
              return function (b, c) {
                let j, k; b = e(f(b)); c = d(c); const l = b.length; return c < 0 || c >= l ? a ? '' : void 0 : (j = h(b, c)) < 55296 || j > 56319 || c + 1 === l || (k = h(b, c + 1)) < 56320 || k > 57343 ? a ? g(b, c) : j : a ? i(b, c, c + 2) : k - 56320 + (j - 55296 << 10) + 65536;
              };
            }; a.exports = { codeAt: c(!1), charAt: c(!0) };
          }, function (a, b, c) {
            'use strict'; let d, e, f; b = c(105); let g = c(8); const h = c(13); const i = c(23); const j = c(14); const k = c(43); const l = c(49); c = c(50); const m = g.TypeError; g = g.WeakMap; if (b || k.state) {
              const n = k.state || (k.state = new g()); n.get = n.get, n.has = n.has, n.set = n.set, d = function (a, b) {
                if (n.has(a)) {
                  throw m('Object already initialized');
                } return b.facade = a, n.set(a, b), b;
              }, e = function (a) {
                return n.get(a) || {};
              }, f = function (a) {
                return n.has(a);
              };
            } else {
              const o = l('state'); c[o] = !0, d = function (a, b) {
                if (j(a, o)) {
                  throw m('Object already initialized');
                } return b.facade = a, i(a, o, b), b;
              }, e = function (a) {
                return j(a, o) ? a[o] : {};
              }, f = function (a) {
                return j(a, o);
              };
            }a.exports = { set: d, get: e, has: f, enforce(a) {
              return f(a) ? e(a) : d(a, {});
            }, getterFor(a) {
              return function (b) {
                let c; if (!h(b) || (c = e(b)).type !== a) {
                  throw m(`Incompatible receiver, ${a} required`);
                } return c;
              };
            } };
          }, function (a, b, c) {
            'use strict'; b = c(8); c = c(3); b = b.WeakMap; a.exports = c(b) && /native code/.test(String(b));
          }, function (a, b, c) {
            'use strict'; const d = c(10); const e = c(16); const f = c(31); b = c(107); const g = c(3); const h = c(108); const i = c(70); const j = c(116); const k = c(72); const l = c(23); const m = c(71); const n = c(6); const o = c(35); c = c(67); const p = b.PROPER; const q = b.CONFIGURABLE; const r = c.IteratorPrototype; const s = c.BUGGY_SAFARI_ITERATORS; const t = n('iterator'); const u = function () {
              return this;
            }; a.exports = function (a, b, c, v, n, w, x) {
              h(c, b, v); let y, z; v = function (a) {
                if (a === n && E) {
                  return E;
                } if (!s && a && a in C) {
                  return C[a];
                } switch (a) {
                  case 'keys':case 'values':case 'entries':return function () {
                    return new c(this, a);
                  };
                } return function () {
                  return new c(this);
                };
              }; const A = `${b} Iterator`; let B = !1; var C = a.prototype; const D = C[t] || C['@@iterator'] || n && C[n]; var E = !s && D || v(n); let F = b === 'Array' && C.entries || D; if (F && (y = i(F.call(new a()))) !== Object.prototype && y.next && (f || i(y) === r || (j ? j(y, r) : g(y[t]) || m(y, t, u)), k(y, A, !0, !0), f && (o[A] = u)), p && n === 'values' && D && D.name !== 'values' && (!f && q
                ? l(C, 'name', 'values')
                : (B = !0, E = function () {
                    return e(D, this);
                  })), n) {
                if (z = { values: v('values'), keys: w ? E : v('keys'), entries: v('entries') }, x) {
                  for (F in z) {
                    (s || B || !(F in C)) && m(C, F, z[F]);
                  }
                } else {
                  d({ target: b, proto: !0, forced: s || B }, z);
                }
              } return f && !x || C[t] === E || m(C, t, E, { name: n }), o[b] = E, z;
            };
          }, function (a, b, c) {
            'use strict'; b = c(15); c = c(14); const d = Function.prototype; const e = b && Object.getOwnPropertyDescriptor; c = c(d, 'name'); const f = c && function () {}.name === 'something'; b = c && (!b || b && e(d, 'name').configurable); a.exports = { EXISTS: c, PROPER: f, CONFIGURABLE: b };
          }, function (a, b, c) {
            'use strict'; const d = c(67).IteratorPrototype; const e = c(68); const f = c(27); const g = c(72); const h = c(35); const i = function () {
              return this;
            }; a.exports = function (a, b, c, j) {
              b = `${b} Iterator`; return a.prototype = e(d, { next: f(+!j, c) }), g(a, b, !1, !0), h[b] = i, a;
            };
          }, function (a, b, c) {
            'use strict'; a = c(15); const d = c(63); const e = c(32); const f = c(17); const g = c(28); const h = c(110); b.f = a && !d
              ? Object.defineProperties
              : function (a, b) {
                f(a); for (var c, d = g(b), b = h(b), i = b.length, j = 0; i > j;) {
                  e.f(a, c = b[j++], d[c]);
                } return a;
              };
          }, function (a, b, c) {
            'use strict'; const d = c(111); const e = c(69); a.exports = Object.keys || function (a) {
              return d(a, e);
            };
          }, function (a, b, c) {
            'use strict'; b = c(7); const d = c(14); const e = c(28); const f = c(51).indexOf; const g = c(50); const h = b([].push); a.exports = function (a, b) {
              let c; a = e(a); let i = 0; const j = []; for (c in a) {
                !d(g, c) && d(a, c) && h(j, c);
              } for (;b.length > i;) {
                d(a, c = b[i++]) && (~f(j, c) || h(j, c));
              } return j;
            };
          }, function (a, b, c) {
            'use strict'; const d = c(46); const e = Math.max; const f = Math.min; a.exports = function (a, b) {
              a = d(a); return a < 0 ? e(a + b, 0) : f(a, b);
            };
          }, function (a, b, c) {
            'use strict'; b = c(30); a.exports = b('document', 'documentElement');
          }, function (a, b, c) {
            'use strict'; b = c(5); a.exports = !b(() => {
              function a() {} return a.prototype.constructor = null, Object.getPrototypeOf(new a()) !== a.prototype;
            });
          }, function (a, b, c) {
            'use strict'; b = c(47); const d = c(34); a.exports = b
              ? {}.toString
              : function () {
                return `[object ${d(this)}]`;
              };
          }, function (a, b, c) {
            'use strict'; const d = c(117); const e = c(17); const f = c(118); a.exports = Object.setPrototypeOf || ('__proto__' in {}
              ? (function () {
                  let a; let b = !1; const c = {}; try {
                    (a = d(Object.prototype, '__proto__', 'set'))(c, []), b = Array.isArray(c);
                  } catch (a) {} return function (c, d) {
                    return e(c), f(d), b ? a(c, d) : c.__proto__ = d, c;
                  };
                }())
              : void 0);
          }, function (a, b, c) {
            'use strict'; const d = c(7); const e = c(21); a.exports = function (a, b, c) {
              try {
                return d(e(Object.getOwnPropertyDescriptor(a, b)[c]));
              } catch (a) {}
            };
          }, function (a, b, c) {
            'use strict'; const d = c(3); const e = String; const f = TypeError; a.exports = function (a) {
              if (J(a) == 'object' || d(a)) {
                return a;
              } throw f(`Can't set ${e(a)} as a prototype`);
            };
          }, function (a, b, c) {
            'use strict'; a.exports = function (a, b) {
              return { value: a, done: b };
            };
          }, function (a, b, c) {
            'use strict'; a = c(10); b = c(121); a({ target: 'Array', stat: !0, forced: !c(127)((a) => {
              Array.from(a);
            }) }, { from: b });
          }, function (a, b, c) {
            'use strict'; const d = c(44); const e = c(16); const f = c(22); const g = c(122); const h = c(124); const i = c(65); const j = c(33); const k = c(125); const l = c(126); const m = c(73); const n = Array; a.exports = function (a) {
              const b = f(a); const c = i(this); const o = arguments.length; let p = o > 1 ? arguments[1] : void 0; const q = void 0 !== p; q && (p = d(p, o > 2 ? arguments[2] : void 0)); let r; let s; let t; let u; let v; let w; const x = m(b); let y = 0; if (!x || this === n && h(x)) {
                for (r = j(b), s = c ? new this(r) : n(r); r > y; y++) {
                  w = q ? p(b[y], y) : b[y], k(s, y, w);
                }
              } else {
                for (v = (u = l(b, x)).next, s = c ? new this() : []; !(t = e(v, u)).done; y++) {
                  w = q ? g(u, p, [t.value, y], !0) : t.value, k(s, y, w);
                }
              } return s.length = y, s;
            };
          }, function (a, b, c) {
            'use strict'; const d = c(17); const e = c(123); a.exports = function (a, b, c, f) {
              try {
                return f ? b(d(c)[0], c[1]) : b(c);
              } catch (b) {
                e(a, 'throw', b);
              }
            };
          }, function (a, b, c) {
            'use strict'; const d = c(16); const e = c(17); const f = c(42); a.exports = function (a, b, c) {
              let g, h; e(a); try {
                if (!(g = f(a, 'return'))) {
                  if (b === 'throw') {
                    throw c;
                  } return c;
                }g = d(g, a);
              } catch (a) {
                h = !0, g = a;
              } if (b === 'throw') {
                throw c;
              } if (h) {
                throw g;
              } return e(g), c;
            };
          }, function (a, b, c) {
            'use strict'; b = c(6); const d = c(35); const e = b('iterator'); const f = Array.prototype; a.exports = function (a) {
              return void 0 !== a && (d.Array === a || f[e] === a);
            };
          }, function (a, b, c) {
            'use strict'; const d = c(39); const e = c(32); const f = c(27); a.exports = function (a, b, c) {
              b = d(b); b in a ? e.f(a, b, f(0, c)) : a[b] = c;
            };
          }, function (a, b, c) {
            'use strict'; const d = c(16); const e = c(21); const f = c(17); const g = c(58); const h = c(73); const i = TypeError; a.exports = function (a, b) {
              const c = arguments.length < 2 ? h(a) : b; if (e(c)) {
                return f(d(c, a));
              } throw i(`${g(a)} is not iterable`);
            };
          }, function (a, b, c) {
            'use strict'; const d = c(6)('iterator'); let e = !1; try {
              let f = 0; b = { next() {
                return { done: !!f++ };
              }, return() {
                e = !0;
              } }; b[d] = function () {
                return this;
              }, Array.from(b, () => {
                throw 2;
              });
            } catch (a) {}a.exports = function (a, b) {
              try {
                if (!b && !e) {
                  return !1;
                }
              } catch (a) {
                return !1;
              }b = !1; try {
                const c = {}; c[d] = function () {
                  return { next() {
                    return { done: b = !0 };
                  } };
                }, a(c);
              } catch (a) {} return b;
            };
          }, function (a, b, c) {
            'use strict'; b = c(129); a.exports = b;
          }, function (a, b, c) {
            'use strict'; b = c(130); a.exports = b;
          }, function (a, b, c) {
            'use strict'; b = c(131); a.exports = b;
          }, function (a, b, c) {
            'use strict'; c(132); b = c(18); a.exports = b('Array', 'includes');
          }, function (a, b, c) {
            'use strict'; a = c(10); const d = c(51).includes; b = c(5); c = c(74); a({ target: 'Array', proto: !0, forced: b(() => {
              return !Array(1).includes();
            }) }, { includes(a) {
              return d(this, a, arguments.length > 1 ? arguments[1] : void 0);
            } }), c('includes');
          }, function (a, b, c) {
            'use strict'; b = c(134); a.exports = b;
          }, function (a, b, c) {
            'use strict'; b = c(135); a.exports = b;
          }, function (a, b, c) {
            'use strict'; b = c(136); a.exports = b;
          }, function (a, b, c) {
            'use strict'; c(137); b = c(18); a.exports = b('Array', 'filter');
          }, function (a, b, c) {
            'use strict'; a = c(10); const d = c(45).filter; a({ target: 'Array', proto: !0, forced: !c(66)('filter') }, { filter(a) {
              return d(this, a, arguments.length > 1 ? arguments[1] : void 0);
            } });
          }, function (a, b, c) {
            'use strict'; b = c(139); a.exports = b;
          }, function (a, b, c) {
            'use strict'; b = c(140); a.exports = b;
          }, function (a, b, c) {
            'use strict'; b = c(141); a.exports = b;
          }, function (a, b, c) {
            'use strict'; c(142); b = c(18); a.exports = b('Array', 'reduce');
          }, function (a, b, c) {
            'use strict'; a = c(10); const d = c(143).left; b = c(75); const e = c(41); a({ target: 'Array', proto: !0, forced: !c(144) && e > 79 && e < 83 || !b('reduce') }, { reduce(a) {
              const b = arguments.length; return d(this, a, b, b > 1 ? arguments[1] : void 0);
            } });
          }, function (a, b, c) {
            'use strict'; const d = c(21); const e = c(22); const f = c(37); const g = c(33); const h = TypeError; b = function (a) {
              return function (b, c, i, j) {
                d(c); b = e(b); const k = f(b); const l = g(b); let m = a ? l - 1 : 0; const n = a ? -1 : 1; if (i < 2) {
                  for (;;) {
                    if (m in k) {
                      j = k[m], m += n; break;
                    } if (m += n, a ? m < 0 : l <= m) {
                      throw h('Reduce of empty array with no initial value');
                    }
                  }
                } for (;a ? m >= 0 : l > m; m += n) {
                  m in k && (j = c(j, k[m], m, b));
                } return j;
              };
            }; a.exports = { left: b(!1), right: b(!0) };
          }, function (a, b, c) {
            'use strict'; b = c(8); c = c(20); a.exports = c(b.process) === 'process';
          }, function (a, b, c) {
            'use strict'; b = c(146); a.exports = b;
          }, function (a, b, c) {
            'use strict'; b = c(147); a.exports = b;
          }, function (a, b, c) {
            'use strict'; b = c(148); a.exports = b;
          }, function (a, b, c) {
            'use strict'; c(149); b = c(18); a.exports = b('String', 'startsWith');
          }, function (a, b, c) {
            'use strict'; a = c(10); b = c(26); const d = c(54).f; const e = c(64); const f = c(48); const g = c(150); const h = c(29); let i = c(152); c = c(31); const j = b(''.startsWith); const k = b(''.slice); const l = Math.min; b = i('startsWith'); a({ target: 'String', proto: !0, forced: !!(c || b || (i = d(String.prototype, 'startsWith'), !i || i.writable)) && !b }, { startsWith(a) {
              const b = f(h(this)); g(a); const c = e(l(arguments.length > 1 ? arguments[1] : void 0, b.length)); const d = f(a); return j ? j(b, d, c) : k(b, c, c + d.length) === d;
            } });
          }, function (a, b, c) {
            'use strict'; const d = c(151); const e = TypeError; a.exports = function (a) {
              if (d(a)) {
                throw e('The method doesn\'t accept regular expressions');
              } return a;
            };
          }, function (a, b, c) {
            'use strict'; const d = c(13); const e = c(20); const f = c(6)('match'); a.exports = function (a) {
              let b; return d(a) && (void 0 !== (b = a[f]) ? !!b : e(a) === 'RegExp');
            };
          }, function (a, b, c) {
            'use strict'; const d = c(6)('match'); a.exports = function (a) {
              const b = /./; try {
                '/./'[a](b);
              } catch (c) {
                try {
                  return b[d] = !1, '/./'[a](b);
                } catch (a) {}
              } return !1;
            };
          }, function (a, b, c) {
            'use strict'; b = c(154); a.exports = b;
          }, function (a, b, c) {
            'use strict'; b = c(155); a.exports = b;
          }, function (a, b, c) {
            'use strict'; b = c(156); a.exports = b;
          }, function (a, b, c) {
            'use strict'; c(157); b = c(18); a.exports = b('Array', 'indexOf');
          }, function (a, b, c) {
            'use strict'; a = c(10); b = c(26); const d = c(51).indexOf; c = c(75); const e = b([].indexOf); const f = !!e && 1 / e([1], 1, -0) < 0; a({ target: 'Array', proto: !0, forced: f || !c('indexOf') }, { indexOf(a) {
              const b = arguments.length > 1 ? arguments[1] : void 0; return f ? e(this, a, b) || 0 : d(this, a, b);
            } });
          }, function (a, b, c) {
            'use strict'; b = c(159); a.exports = b;
          }, function (a, b, c) {
            'use strict'; b = c(160); a.exports = b;
          }, function (a, b, c) {
            'use strict'; b = c(161); a.exports = b;
          }, function (a, b, c) {
            'use strict'; c(162); b = c(18); a.exports = b('Array', 'find');
          }, function (a, b, c) {
            'use strict'; a = c(10); const d = c(45).find; b = c(74); c = !0; 'find' in [] && Array(1).find(() => {
              c = !1;
            }), a({ target: 'Array', proto: !0, forced: c }, { find(a) {
              return d(this, a, arguments.length > 1 ? arguments[1] : void 0);
            } }), b('find');
          }, function (a, b, c) {
            'use strict'; c.r(b); const d = {}; c.r(d), c.d(d, 'BUTTON_SELECTOR_SEPARATOR', () => {
              return Ia;
            }), c.d(d, 'BUTTON_SELECTORS', () => {
              return Ja;
            }), c.d(d, 'LINK_TARGET_SELECTORS', () => {
              return Ka;
            }), c.d(d, 'BUTTON_SELECTOR_FORM_BLACKLIST', () => {
              return La;
            }), c.d(d, 'EXTENDED_BUTTON_SELECTORS', () => {
              return Ma;
            }), c.d(d, 'EXPLICIT_BUTTON_SELECTORS', () => {
              return Na;
            }); const e = {}; function h(a) {
              if (a == null) {
                return null;
              } if (a.innerText != null && a.innerText.length !== 0) {
                return a.innerText;
              } const b = a.text; return b != null && typeof b == 'string' && b.length !== 0 ? b : a.textContent != null && a.textContent.length > 0 ? a.textContent : null;
            }c.r(e), c.d(e, 'mergeProductMetadata', () => {
              return Id;
            }), c.d(e, 'extractSchemaOrg', () => {
              return Od;
            }), c.d(e, 'extractJsonLd', () => {
              return Wd;
            }), c.d(e, 'extractOpenGraph', () => {
              return je;
            }), c.d(e, 'extractMetaTagData', () => {
              return me;
            }), c.d(e, 'stripJsonComments', () => {
              return ne;
            }), c.d(e, 'jsonRepair', () => {
              return oe;
            }); function i(a) {
              const b = a.tagName.toLowerCase(); let c = void 0; switch (b) {
                case 'meta':c = a.getAttribute('content'); break; case 'audio':case 'embed':case 'iframe':case 'img':case 'source':case 'track':case 'video':c = a.getAttribute('src'); break; case 'a':case 'area':case 'link':c = a.getAttribute('href'); break; case 'object':c = a.getAttribute('data'); break; case 'data':case 'meter':c = a.getAttribute('value'); break; case 'time':c = a.getAttribute('datetime'); break; default:c = h(a) || '';
              } return b === 'span' && (c == null || typeof c == 'string' && c === '') && (c = a.getAttribute('content')), typeof c == 'string' ? c.substr(0, 500) : '';
            } const j = ['Order', 'AggregateOffer', 'CreativeWork', 'Event', 'MenuItem', 'Product', 'Service', 'Trip', 'ActionAccessSpecification', 'ConsumeAction', 'MediaSubscription', 'Organization', 'Person']; let k = c(11); const l = c.n(k); k = c(1); const m = c.n(k); k = c(2); const n = c.n(k); k = c(4); const o = c.n(k); k = c(12); const p = c.n(k); k = c(0); const q = c.n(k); const r = function (a) {
              for (var b = q()(j, (a) => {
                  return '[vocab$="'.concat('http://schema.org/', '"][typeof$="').concat(a, '"]');
                }).join(', '), c = [], b = o()(g.querySelectorAll(b)), d = []; b.length > 0;) {
                let e = b.pop(); if (!p()(c, e)) {
                  let f = { '@context': 'http://schema.org' }; d.push({ htmlElement: e, jsonLD: f }); for (e = [{ element: e, workingNode: f }]; e.length;) {
                    f = e.pop(); const r = f.element; f = f.workingNode; let s = m()(r.getAttribute('typeof')); f['@type'] = s; for (s = o()(r.querySelectorAll('[property]')).reverse(); s.length;) {
                      const h = s.pop(); if (!p()(c, h)) {
                        c.push(h); const k = m()(h.getAttribute('property')); if (h.hasAttribute('typeof')) {
                          const t = {}; f[k] = t, e.push({ element: r, workingNode: f }), e.push({ element: h, workingNode: t }); break;
                        }f[k] = i(h);
                      }
                    }
                  }
                }
              } return n()(d, (b) => {
                return l()(b.htmlElement, a);
              });
            }; function s(a) {
              return (s = typeof Symbol == 'function' && J(typeof Symbol === 'function' ? Symbol.iterator : '@@iterator') == 'symbol'
                ? function (a) {
                  return J(a);
                }
                : function (a) {
                  return a && typeof Symbol == 'function' && a.constructor === Symbol && a !== (typeof Symbol === 'function' ? Symbol.prototype : '@@prototype') ? 'symbol' : J(a);
                })(a);
            } function t(a) {
              return ((typeof HTMLElement == 'undefined' ? 'undefined' : s(HTMLElement)) === 'object' ? a instanceof HTMLElement : a != null && s(a) === 'object' && a !== null && a.nodeType === 1 && typeof a.nodeName == 'string') ? a : null;
            }k = c(9); const u = c.n(k); function v(a) {
              return (v = typeof Symbol == 'function' && J(typeof Symbol === 'function' ? Symbol.iterator : '@@iterator') == 'symbol'
                ? function (a) {
                  return J(a);
                }
                : function (a) {
                  return a && typeof Symbol == 'function' && a.constructor === Symbol && a !== (typeof Symbol === 'function' ? Symbol.prototype : '@@prototype') ? 'symbol' : J(a);
                })(a);
            } function w(a, b) {
              const c = Object.keys(a); if (Object.getOwnPropertySymbols) {
                let d = Object.getOwnPropertySymbols(a); b && (d = d.filter((b) => {
                  return Object.getOwnPropertyDescriptor(a, b).enumerable;
                })), c.push.apply(c, d);
              } return c;
            } function x(a) {
              for (let b = 1; b < arguments.length; b++) {
                var c = arguments[b] != null ? arguments[b] : {}; b % 2
                  ? w(Object(c), !0).forEach((b) => {
                    z(a, b, c[b]);
                  })
                  : Object.getOwnPropertyDescriptors
                    ? Object.defineProperties(a, Object.getOwnPropertyDescriptors(c))
                    : w(Object(c)).forEach((b) => {
                      Object.defineProperty(a, b, Object.getOwnPropertyDescriptor(c, b));
                    });
              } return a;
            } function y(a, b) {
              for (let c = 0; c < b.length; c++) {
                const d = b[c]; d.enumerable = d.enumerable || !1, d.configurable = !0, 'value' in d && (d.writable = !0), Object.defineProperty(a, A(d.key), d);
              }
            } function z(a, b, c) {
              return (b = A(b)) in a ? Object.defineProperty(a, b, { value: c, enumerable: !0, configurable: !0, writable: !0 }) : a[b] = c, a;
            } function A(a) {
              a = (function (a, b) {
                if (v(a) !== 'object' || a === null) {
                  return a;
                } let c = a[typeof Symbol === 'function' ? Symbol.toPrimitive : '@@toPrimitive']; if (void 0 !== c) {
                  c = c.call(a, b || 'default'); if (v(c) !== 'object') {
                    return c;
                  } throw new TypeError('@@toPrimitive must return a primitive value.');
                } return (b === 'string' ? String : Number)(a);
              }(a, 'string')); return v(a) === 'symbol' ? a : String(a);
            } const B = (function () {
              function a(b) {
                !(function (a, b) {
                  if (!(a instanceof b)) {
                    throw new TypeError('Cannot call a class as a function');
                  }
                }(this, a)), z(this, '_anchorElement', void 0), z(this, '_parsedQuery', void 0), this._anchorElement = g.createElement('a'), this._anchorElement.href = b;
              } let b, c, d; return b = a, (c = [{ key: 'hash', get() {
                return this._anchorElement.hash;
              } }, { key: 'host', get() {
                return this._anchorElement.host;
              } }, { key: 'hostname', get() {
                return this._anchorElement.hostname;
              } }, { key: 'pathname', get() {
                return this._anchorElement.pathname.replace(/(^\/?)/, '/');
              } }, { key: 'port', get() {
                return this._anchorElement.port;
              } }, { key: 'protocol', get() {
                return this._anchorElement.protocol;
              } }, { key: 'searchParams', get() {
                const a = this; return { get(b) {
                  if (a._parsedQuery != null) {
 return a._parsedQuery[b] || null; 
} let c = a._anchorElement.search; if (c === '' || c == null) {
 return a._parsedQuery = {}, null; 
} c = c[0] === '?' ? c.substring(1) : c; return a._parsedQuery = u()(c.split('&'), (a, b) => {
                    b = b.split('='); return b == null || b.length !== 2 ? a : x(x({}, a), {}, z({}, decodeURIComponent(b[0]), decodeURIComponent(b[1])));
                  }, {}), a._parsedQuery[b] || null;
                } };
              } }, { key: 'toString', value() {
                return this._anchorElement.href;
              } }, { key: 'toJSON', value() {
                return this._anchorElement.href;
              } }]) && y(b.prototype, c), d && y(b, d), Object.defineProperty(b, 'prototype', { writable: !1 }), a;
            }()); const C = /^\s*:scope/gi; k = function a(b, c) {
              if (c[c.length - 1] === '>') {
                return [];
              } let d = c[0] === '>'; if ((a.CAN_USE_SCOPE || !c.match(C)) && !d) {
                return b.querySelectorAll(c);
              } let e = c; d && (e = ':scope '.concat(c)); d = !1; b.id || (b.id = `__fb_scoped_query_selector_${Date.now()}`, d = !0); c = b.querySelectorAll(e.replace(C, `#${b.id}`)); return d && (b.id = ''), c;
            }; k.CAN_USE_SCOPE = !0; let D = g.createElement('div'); try {
              D.querySelectorAll(':scope *');
            } catch (a) {
              k.CAN_USE_SCOPE = !1;
            } const E = k; D = c(36); const F = c.n(D); k = c(19); const G = c.n(k); D = (c(52), c(24)); const H = c.n(D); function I(a) {
              return (function (a) {
                if (Array.isArray(a)) {
                  return M(a);
                }
              }(a)) || (function (a) {
                if (typeof Symbol != 'undefined' && a[typeof Symbol === 'function' ? Symbol.iterator : '@@iterator'] != null || a['@@iterator'] != null) {
                  return Array.from(a);
                }
              }(a)) || L(a) || (function () {
                throw new TypeError('Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.');
              }());
            } function K(a, b) {
              return (function (a) {
                if (Array.isArray(a)) {
                  return a;
                }
              }(a)) || (function (a, b) {
                let c = a == null ? null : typeof Symbol != 'undefined' && a[typeof Symbol === 'function' ? Symbol.iterator : '@@iterator'] || a['@@iterator']; if (c != null) {
                  let d; let e; const f = []; let g = !0; let h = !1; try {
                    if (a = (c = c.call(a)).next, b === 0) {
                      if (Object(c) !== c) {
                        return;
                      } g = !1;
                    } else {
                      for (;!(g = (d = a.call(c)).done) && (f.push(d.value), f.length !== b); g = !0) {
                        ;
                      }
                    }
                  } catch (a) {
                    h = !0, e = a;
                  } finally {
                    try {
                      if (!g && c.return != null && (d = c.return(), Object(d) !== d)) {
                        return;
                      }
                    } finally {
                      if (h) {
                        throw e;
                      }
                    }
                  } return f;
                }
              }(a, b)) || L(a, b) || (function () {
                throw new TypeError('Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.');
              }());
            } function L(a, b) {
              if (a) {
                if (typeof a == 'string') {
                  return M(a, b);
                } let c = Object.prototype.toString.call(a).slice(8, -1); return c === 'Object' && a.constructor && (c = a.constructor.name), c === 'Map' || c === 'Set' ? Array.from(a) : c === 'Arguments' || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(c) ? M(a, b) : void 0;
              }
            } function M(a, b) {
              (b == null || b > a.length) && (b = a.length); for (var c = 0, d = new Array(b); c < b; c++) {
                d[c] = a[c];
              } return d;
            } function N(a, b) {
              return O(a, n()(q()(b.split(/((?:closest|children)\([^)]+\))/), (a) => {
                return a.trim();
              }), Boolean));
            } function O(a, b) {
              const c = function (a, b) {
                return b.substring(a.length, b.length - 1).trim();
              }; b = q()(b, (a) => {
                return H()(a, 'closest(') ? { selector: c('closest(', a), type: 'closest' } : H()(a, 'children(') ? { selector: c('children(', a), type: 'children' } : { selector: a, type: 'standard' };
              }); b = u()(b, (a, b) => {
                if (b.type !== 'standard') {
                  return [].concat(I(a), [b]);
                } const c = a[a.length - 1]; return c && c.type === 'standard' ? (c.selector += ` ${b.selector}`, a) : [].concat(I(a), [b]);
              }, []); return u()(b, (a, b) => {
                return n()(F()(q()(a, (a) => {
                  return P(a, b);
                })), Boolean);
              }, [a]);
            } var P = function (a, b) {
              const c = b.selector; switch (b.type) {
                case 'children':if (a == null) {
                  return [];
                } b = K(c.split(','), 2); var d = b[0]; var e = b[1]; return [o()(n()(o()(a.childNodes), (a) => {
                    return t(a) != null && a.matches(e);
                  }))[Number.parseInt(d, 0)]]; case 'closest':return a.parentNode ? [a.parentNode.closest(c)] : []; default:return o()(E(a, c));
              }
            }; if (Element.prototype.matches || (Element.prototype.matches = Element.prototype.msMatchesSelector || Element.prototype.webkitMatchesSelector), !Element.prototype.closest) {
              const Q = g.documentElement; Element.prototype.closest = function (a) {
                let b = this; if (!Q.contains(b)) {
                  return null;
                } do {
                  if (b.matches(a)) {
                    return b;
                  } b = b.parentElement || b.parentNode;
                } while (b !== null && b.nodeType === 1); return null;
              };
            } const aa = ['og', 'product', 'music', 'video', 'article', 'book', 'profile', 'website', 'twitter']; function R(a) {
              return (R = typeof Symbol == 'function' && J(typeof Symbol === 'function' ? Symbol.iterator : '@@iterator') == 'symbol'
                ? function (a) {
                  return J(a);
                }
                : function (a) {
                  return a && typeof Symbol == 'function' && a.constructor === Symbol && a !== (typeof Symbol === 'function' ? Symbol.prototype : '@@prototype') ? 'symbol' : J(a);
                })(a);
            } function ba(a, b) {
              const c = Object.keys(a); if (Object.getOwnPropertySymbols) {
                let d = Object.getOwnPropertySymbols(a); b && (d = d.filter((b) => {
                  return Object.getOwnPropertyDescriptor(a, b).enumerable;
                })), c.push.apply(c, d);
              } return c;
            } function ca(a) {
              for (let b = 1; b < arguments.length; b++) {
                var c = arguments[b] != null ? arguments[b] : {}; b % 2
                  ? ba(Object(c), !0).forEach((b) => {
                    da(a, b, c[b]);
                  })
                  : Object.getOwnPropertyDescriptors
                    ? Object.defineProperties(a, Object.getOwnPropertyDescriptors(c))
                    : ba(Object(c)).forEach((b) => {
                      Object.defineProperty(a, b, Object.getOwnPropertyDescriptor(c, b));
                    });
              } return a;
            } function da(a, b, c) {
              return (b = (function (a) {
                a = (function (a, b) {
                  if (R(a) !== 'object' || a === null) {
                    return a;
                  } let c = a[typeof Symbol === 'function' ? Symbol.toPrimitive : '@@toPrimitive']; if (void 0 !== c) {
                    c = c.call(a, b || 'default'); if (R(c) !== 'object') {
                      return c;
                    } throw new TypeError('@@toPrimitive must return a primitive value.');
                  } return (b === 'string' ? String : Number)(a);
                }(a, 'string')); return R(a) === 'symbol' ? a : String(a);
              }(b))) in a
                ? Object.defineProperty(a, b, { value: c, enumerable: !0, configurable: !0, writable: !0 })
                : a[b] = c, a;
            } const ea = function () {
              const a = u()(n()(q()(o()(g.querySelectorAll('meta[property]')), (a) => {
                const b = a.getAttribute('property'); a = a.getAttribute('content'); return typeof b == 'string' && b.includes(':') && typeof a == 'string' && p()(aa, b.split(':')[0]) ? { key: b, value: a.substr(0, 500) } : null;
              }), Boolean), (a, b) => {
                return ca(ca({}, a), {}, da({}, b.key, a[b.key] || b.value));
              }, {}); return a['og:type'] !== 'product.item' ? null : { '@context': 'http://schema.org', '@type': 'Product', 'offers': { price: a['product:price:amount'], priceCurrency: a['product:price:currency'] }, 'productID': a['product:retailer_item_id'] };
            }; const fa = 'PATH'; const ga = 'QUERY_STRING'; function ha(a) {
              return (function (a) {
                if (Array.isArray(a)) {
                  return ja(a);
                }
              }(a)) || (function (a) {
                if (typeof Symbol != 'undefined' && a[typeof Symbol === 'function' ? Symbol.iterator : '@@iterator'] != null || a['@@iterator'] != null) {
                  return Array.from(a);
                }
              }(a)) || ia(a) || (function () {
                throw new TypeError('Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.');
              }());
            } function ia(a, b) {
              if (a) {
                if (typeof a == 'string') {
                  return ja(a, b);
                } let c = Object.prototype.toString.call(a).slice(8, -1); return c === 'Object' && a.constructor && (c = a.constructor.name), c === 'Map' || c === 'Set' ? Array.from(a) : c === 'Arguments' || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(c) ? ja(a, b) : void 0;
              }
            } function ja(a, b) {
              (b == null || b > a.length) && (b = a.length); for (var c = 0, d = new Array(b); c < b; c++) {
                d[c] = a[c];
              } return d;
            } function ka(a, b) {
              a = m()(t(a)).className; b = m()(t(b)).className; a = a.split(' '); const c = b.split(' '); return a.filter((a) => {
                return c.includes(a);
              }).toString();
            } const S = 0; const la = 1; const ma = 2; function na(a, b) {
              if (a && !b || !a && b || void 0 === a || void 0 === b || a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) {
                return S;
              } a = t(a); b = t(b); if (a && !b || !a && b) {
                return S;
              } if (a && b) {
                if (a.tagName !== b.tagName) {
                  return S;
                } if (a.className === b.className) {
                  return la;
                }
              } return ma;
            } function oa(a, b, c, d) {
              const e = na(a, d.node); return e === S ? e : c > 0 && b !== d.index ? S : e === 1 ? la : d.relativeClass.length === 0 ? S : (ka(a, d.node), d.relativeClass, la);
            } function pa(a, b, c, d) {
              if (d === c.length - 1) {
                if (!oa(a, b, d, c[d])) {
                  return null;
                } var e = t(a); if (e) {
                  return [e];
                }
              } if (!a || !oa(a, b, d, c[d])) {
                return null;
              } for (e = [], b = a.firstChild, a = 0; b;) {
                const f = pa(b, a, c, d + 1); f && e.push.apply(e, ha(f)), b = b.nextSibling, a += 1;
              } return e;
            } function qa(a, b) {
              const c = []; const d = (function (a, b) {
                let c = typeof Symbol != 'undefined' && a[typeof Symbol === 'function' ? Symbol.iterator : '@@iterator'] || a['@@iterator']; if (!c) {
                  if (Array.isArray(a) || (c = ia(a)) || b && a && typeof a.length == 'number') {
                    c && (a = c); let g = 0; b = function () {}; return { s: b, n() {
                      return g >= a.length ? { done: !0 } : { done: !1, value: a[g++] };
                    }, e(a) {
                      throw a;
                    }, f: b };
                  } throw new TypeError('Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.');
                } let d; let e = !0; let f = !1; return { s() {
                  c = c.call(a);
                }, n() {
                  const a = c.next(); return e = a.done, a;
                }, e(a) {
                  f = !0, d = a;
                }, f() {
                  try {
                    e || c.return == null || c.return();
                  } finally {
                    if (f) {
                      throw d;
                    }
                  }
                } };
              }(a)); try {
                for (d.s(); !(a = d.n()).done;) {
                  a = pa(a.value, 0, b, 0); a && c.push.apply(c, ha(a));
                }
              } catch (a) {
                d.e(a);
              } finally {
                d.f();
              } return c;
            } function ra(a, b) {
              a = (function (a, b) {
                for (var c = function (a) {
                    var b = a.parentNode; if (!b) {
                      return -1;
                    } for (var b = b.firstChild, c = 0; b && b !== a;) {
                      b = b.nextSibling, c += 1;
                    } return b === a ? c : -1;
                  }, a = a, b = b, d = [], e = []; !a.isSameNode(b);) {
                  const f = na(a, b); if (f === S) {
                    return null;
                  } let g = ''; if (f === ma && (g = ka(a, b)).length === 0) {
                    return null;
                  } if (d.push({ node: a, relativeClass: g, index: c(a) }), e.push(b), a = a.parentNode, b = b.parentNode, !a || !b) {
                    return null;
                  }
                } return a && b && a.isSameNode(b) && d.length > 0 ? { parentNode: a, node1Tree: d.reverse(), node2Tree: e.reverse() } : null;
              }(a, b)); if (!a) {
                return null;
              } b = (function (a, b, c) {
                for (var d = [], a = a.firstChild; a;) {
                  a.isSameNode(b.node) || a.isSameNode(c) || !na(b.node, a) || d.push(a), a = a.nextSibling;
                } return d;
              }(a.parentNode, a.node1Tree[0], a.node2Tree[0])); return b && b.length !== 0 ? qa(b, a.node1Tree) : null;
            } function sa(a) {
              return (sa = typeof Symbol == 'function' && J(typeof Symbol === 'function' ? Symbol.iterator : '@@iterator') == 'symbol'
                ? function (a) {
                  return J(a);
                }
                : function (a) {
                  return a && typeof Symbol == 'function' && a.constructor === Symbol && a !== (typeof Symbol === 'function' ? Symbol.prototype : '@@prototype') ? 'symbol' : J(a);
                })(a);
            } function ta(a, b) {
              return (function (a) {
                if (Array.isArray(a)) {
                  return a;
                }
              }(a)) || (function (a, b) {
                let c = a == null ? null : typeof Symbol != 'undefined' && a[typeof Symbol === 'function' ? Symbol.iterator : '@@iterator'] || a['@@iterator']; if (c != null) {
                  let d; let e; const f = []; let g = !0; let h = !1; try {
                    if (a = (c = c.call(a)).next, b === 0) {
                      if (Object(c) !== c) {
                        return;
                      } g = !1;
                    } else {
                      for (;!(g = (d = a.call(c)).done) && (f.push(d.value), f.length !== b); g = !0) {
                        ;
                      }
                    }
                  } catch (a) {
                    h = !0, e = a;
                  } finally {
                    try {
                      if (!g && c.return != null && (d = c.return(), Object(d) !== d)) {
                        return;
                      }
                    } finally {
                      if (h) {
                        throw e;
                      }
                    }
                  } return f;
                }
              }(a, b)) || (function (a, b) {
                if (!a) {
                  return;
                } if (typeof a == 'string') {
                  return ua(a, b);
                } let c = Object.prototype.toString.call(a).slice(8, -1); c === 'Object' && a.constructor && (c = a.constructor.name); if (c === 'Map' || c === 'Set') {
                  return Array.from(a);
                } if (c === 'Arguments' || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(c)) {
                  return ua(a, b);
                }
              }(a, b)) || (function () {
                throw new TypeError('Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.');
              }());
            } function ua(a, b) {
              (b == null || b > a.length) && (b = a.length); for (var c = 0, d = new Array(b); c < b; c++) {
                d[c] = a[c];
              } return d;
            } function va(a, b) {
              const c = Object.keys(a); if (Object.getOwnPropertySymbols) {
                let d = Object.getOwnPropertySymbols(a); b && (d = d.filter((b) => {
                  return Object.getOwnPropertyDescriptor(a, b).enumerable;
                })), c.push.apply(c, d);
              } return c;
            } function wa(a) {
              for (let b = 1; b < arguments.length; b++) {
                var c = arguments[b] != null ? arguments[b] : {}; b % 2
                  ? va(Object(c), !0).forEach((b) => {
                    xa(a, b, c[b]);
                  })
                  : Object.getOwnPropertyDescriptors
                    ? Object.defineProperties(a, Object.getOwnPropertyDescriptors(c))
                    : va(Object(c)).forEach((b) => {
                      Object.defineProperty(a, b, Object.getOwnPropertyDescriptor(c, b));
                    });
              } return a;
            } function xa(a, b, c) {
              return (b = (function (a) {
                a = (function (a, b) {
                  if (sa(a) !== 'object' || a === null) {
                    return a;
                  } let c = a[typeof Symbol === 'function' ? Symbol.toPrimitive : '@@toPrimitive']; if (void 0 !== c) {
                    c = c.call(a, b || 'default'); if (sa(c) !== 'object') {
                      return c;
                    } throw new TypeError('@@toPrimitive must return a primitive value.');
                  } return (b === 'string' ? String : Number)(a);
                }(a, 'string')); return sa(a) === 'symbol' ? a : String(a);
              }(b))) in a
                ? Object.defineProperty(a, b, { value: c, enumerable: !0, configurable: !0, writable: !0 })
                : a[b] = c, a;
            } const ya = u()(['CONSTANT_VALUE', 'CSS', 'URI', 'SCHEMA_DOT_ORG', 'JSON_LD', 'RDFA', 'OPEN_GRAPH', 'GTM', 'META_TAG', 'GLOBAL_VARIABLE'], (a, b, c) => {
              return wa(wa({}, a), {}, xa({}, b, c));
            }, {}); const za = { '@context': 'http://schema.org', '@type': 'Product', 'additionalType': void 0, 'offers': { price: void 0, priceCurrency: void 0 }, 'productID': void 0 }; const Aa = function (a, b, c) {
              if (c == null) {
                return a;
              } const d = m()(a.offers); return { '@context': 'http://schema.org', '@type': 'Product', 'additionalType': a.additionalType != null ? a.additionalType : b === 'content_type' ? c : void 0, 'offers': { price: d.price != null ? d.price : b === 'value' ? c : void 0, priceCurrency: d.priceCurrency != null ? d.priceCurrency : b === 'currency' ? c : void 0 }, 'productID': a.productID != null ? a.productID : b === 'content_ids' ? c : void 0 };
            }; function a(a, b) {
              b = b.sort((a, b) => {
                return ya[a.extractorType] > ya[b.extractorType] ? 1 : -1;
              }); return n()(F()(q()(b, (b) => {
                switch (b.extractorType) {
                  case 'SCHEMA_DOT_ORG':return q()((function (a) {
                    for (var b = q()(j, (a) => {
                        return '[itemtype$="'.concat('schema.org/').concat(a, '"]');
                      }).join(', '), c = [], b = o()(g.querySelectorAll(b)), d = []; b.length > 0;) {
                      let e = b.pop(); if (!p()(c, e)) {
                        let f = { '@context': 'http://schema.org' }; d.push({ htmlElement: e, jsonLD: f }); for (e = [{ element: e, workingNode: f }]; e.length;) {
                          f = e.pop(); const r = f.element; f = f.workingNode; let s = m()(r.getAttribute('itemtype')); f['@type'] = s.substr(s.indexOf('schema.org/') + 'schema.org/'.length); for (s = o()(r.querySelectorAll('[itemprop]')).reverse(); s.length;) {
                            const h = s.pop(); if (!p()(c, h)) {
                              c.push(h); const k = m()(h.getAttribute('itemprop')); if (h.hasAttribute('itemscope')) {
                                const t = {}; f[k] = t, e.push({ element: r, workingNode: f }), e.push({ element: h, workingNode: t }); break;
                              }f[k] = i(h);
                            }
                          }
                        }
                      }
                    } return n()(d, (b) => {
                      return l()(b.htmlElement, a);
                    });
                  }(a)), (a) => {
                    return { extractorID: b.id, jsonLD: a.jsonLD };
                  }); case 'RDFA':return q()(r(a), (a) => {
                    return { extractorID: b.id, jsonLD: a.jsonLD };
                  }); case 'OPEN_GRAPH':return { extractorID: b.id, jsonLD: ea() }; case 'CSS':var c = q()(b.extractorConfig.parameterSelectors, (b) => {
                    return (b = N(a, b.selector)) === null || void 0 === b ? void 0 : b[0];
                  }); if (c == null) {
                      return null;
                    } if (c.length === 2) {
                      var d = c[0]; var e = c[1]; if (d != null && e != null) {
                        d = ra(d, e); d && c.push.apply(c, d);
                      }
                    } var h = b.extractorConfig.parameterSelectors[0].parameterType; e = q()(c, (a) => {
                      a = (a == null ? void 0 : a.innerText) || (a == null ? void 0 : a.textContent); return [h, a];
                    }); d = q()(n()(e, (a) => {
                      return ta(a, 1)[0] !== 'totalPrice';
                    }), (a) => {
                      a = ta(a, 2); const b = a[0]; a = a[1]; return Aa(za, b, a);
                    }); if (b.eventType === 'InitiateCheckout' || b.eventType === 'Purchase') {
                      c = G()(e, (a) => {
                        return ta(a, 1)[0] === 'totalPrice';
                      }); c && (d = [{ '@context': 'http://schema.org', '@type': 'ItemList', 'itemListElement': q()(d, (a, b) => {
                        return { '@type': 'ListItem', 'item': a, 'position': b + 1 };
                      }), 'totalPrice': c[1] != null ? c[1] : void 0 }]);
                    } return q()(d, (a) => {
                      return { extractorID: b.id, jsonLD: a };
                    }); case 'CONSTANT_VALUE':e = b.extractorConfig; c = e.parameterType; d = e.value; return { extractorID: b.id, jsonLD: Aa(za, c, d) }; case 'URI':e = b.extractorConfig.parameterType; c = (function (a, b, c) {
                    a = new B(a); switch (b) {
                      case fa:b = n()(q()(a.pathname.split('/'), (a) => {
                        return a.trim();
                      }), Boolean); var d = Number.parseInt(c, 10); return d < b.length ? b[d] : null; case ga:return a.searchParams.get(c);
                    } return null;
                  }(f.location.href, b.extractorConfig.context, b.extractorConfig.value)); return { extractorID: b.id, jsonLD: Aa(za, e, c) }; default:throw new Error('Extractor '.concat(b.extractorType, ' not mapped'));
                }
              })), (a) => {
                a = a.jsonLD; return Boolean(a);
              });
            }a.EXTRACTOR_PRECEDENCE = ya; const Ba = a; function Ca(a) {
              switch (a.extractor_type) {
                case 'CSS':if (a.extractor_config == null) {
                  throw new Error('extractor_config must be set');
                } var b = a.extractor_config; if (b.parameter_type) {
                    throw new Error('extractor_config must be set');
                  } return { domainURI: new B(a.domain_uri), eventType: a.event_type, extractorConfig: (b = b, { parameterSelectors: q()(b.parameter_selectors, (a) => {
                    return { parameterType: a.parameter_type, selector: a.selector };
                  }) }), extractorType: 'CSS', id: m()(a.id), ruleId: (b = a.event_rule) === null || void 0 === b ? void 0 : b.id }; case 'CONSTANT_VALUE':if (a.extractor_config == null) {
                  throw new Error('extractor_config must be set');
                } b = a.extractor_config; if (b.parameter_selectors) {
                    throw new Error('extractor_config must be set');
                  } return { domainURI: new B(a.domain_uri), eventType: a.event_type, extractorConfig: Da(b), extractorType: 'CONSTANT_VALUE', id: m()(a.id), ruleId: (b = a.event_rule) === null || void 0 === b ? void 0 : b.id }; case 'URI':if (a.extractor_config == null) {
                  throw new Error('extractor_config must be set');
                } b = a.extractor_config; if (b.parameter_selectors) {
                    throw new Error('extractor_config must be set');
                  } return { domainURI: new B(a.domain_uri), eventType: a.event_type, extractorConfig: Ea(b), extractorType: 'URI', id: m()(a.id), ruleId: (b = a.event_rule) === null || void 0 === b ? void 0 : b.id }; default:return { domainURI: new B(a.domain_uri), eventType: a.event_type, extractorType: a.extractor_type, id: m()(a.id), ruleId: (b = a.event_rule) === null || void 0 === b ? void 0 : b.id };
              }
            } function Da(a) {
              return { parameterType: a.parameter_type, value: a.value };
            } function Ea(a) {
              return { context: a.context, parameterType: a.parameter_type, value: a.value };
            }a.EXTRACTOR_PRECEDENCE = ya; const Fa = function (a, b, c) {
              return typeof a != 'string' ? '' : a.length < c && b === 0 ? a : [].concat(o()(a)).slice(b, b + c).join('');
            }; const T = function (a, b) {
              return Fa(a, 0, b);
            }; const Ga = ['button', 'submit', 'input', 'li', 'option', 'progress', 'param']; function Ha(a) {
              let b = h(a); if (b != null && b !== '') {
                return T(b, 120);
              } b = a.type; a = a.value; return b != null && p()(Ga, b) && a != null && a !== '' ? T(a, 120) : T('', 120);
            } var Ia = ', '; var Ja = ['input[type=\'button\']', 'input[type=\'image\']', 'input[type=\'submit\']', 'button', '[class*=btn]', '[class*=Btn]', '[class*=submit]', '[class*=Submit]', '[class*=button]', '[class*=Button]', '[role*=button]', '[href^=\'tel:\']', '[href^=\'callto:\']', '[href^=\'mailto:\']', '[href^=\'sms:\']', '[href^=\'skype:\']', '[href^=\'whatsapp:\']', '[id*=btn]', '[id*=Btn]', '[id*=button]', '[id*=Button]', 'a'].join(Ia); var Ka = ['[href^=\'http://\']', '[href^=\'https://\']'].join(Ia); var La = ['[href^=\'tel:\']', '[href^=\'callto:\']', '[href^=\'sms:\']', '[href^=\'skype:\']', '[href^=\'whatsapp:\']'].join(Ia); var Ma = Ja; var Na = ['input[type=\'button\']', 'input[type=\'submit\']', 'button', 'a'].join(Ia); function Oa(a) {
              let b = ''; if (a.tagName === 'IMG') {
                return a.getAttribute('src') || '';
              } if (f.getComputedStyle) {
                var c = f.getComputedStyle(a).getPropertyValue('background-image'); if (c != null && c !== 'none' && c.length > 0) {
                  return c;
                }
              } if (a.tagName === 'INPUT' && a.getAttribute('type') === 'image') {
                c = a.getAttribute('src'); if (c != null) {
                  return c;
                }
              }c = a.getElementsByTagName('img'); if (c.length !== 0) {
                a = c.item(0); b = (a ? a.getAttribute('src') : null) || '';
              } return b;
            } const Pa = ['sms:', 'mailto:', 'tel:', 'whatsapp:', 'https://wa.me/', 'skype:', 'callto:']; const Qa = /[\-!$><=&_/?.,0-9:; \][%~"{})(+@^`]/g; const Ra = /((([a-z])(?=[A-Z]))|(([A-Z])(?=[A-Z][a-z])))/g; const Sa = /(^\S(?!\S))|((\s)\S(?!\S))/g; const Ta = /\s+/g; function Ua(a) {
              return !!(function (a) {
                const b = Pa; if (!a.hasAttribute('href')) {
                  return !1;
                } const c = a.getAttribute('href'); return c != null && !!G()(b, (a) => {
                  return H()(c, a);
                });
              }(a)) || !!Ha(a).replace(Qa, ' ').replace(Ra, (a) => {
                return `${a} `;
              }).replace(Sa, (a) => {
                return `${T(a, a.length - 1)} `;
              }).replace(Ta, ' ').trim().toLowerCase() || !!Oa(a);
            } function Va(a) {
              if (a == null || a === g.body || !Ua(a)) {
                return !1;
              } a = typeof a.getBoundingClientRect == 'function' && a.getBoundingClientRect().height || a.offsetHeight; return !isNaN(a) && a < 600 && a > 10;
            } function Wa(a, b) {
              for (let c = 0; c < b.length; c++) {
                const d = b[c]; d.enumerable = d.enumerable || !1, d.configurable = !0, 'value' in d && (d.writable = !0), Object.defineProperty(a, Xa(d.key), d);
              }
            } function Xa(a) {
              a = (function (a, b) {
                if (Ya(a) !== 'object' || a === null) {
                  return a;
                } let c = a[typeof Symbol === 'function' ? Symbol.toPrimitive : '@@toPrimitive']; if (void 0 !== c) {
                  c = c.call(a, b || 'default'); if (Ya(c) !== 'object') {
                    return c;
                  } throw new TypeError('@@toPrimitive must return a primitive value.');
                } return (b === 'string' ? String : Number)(a);
              }(a, 'string')); return Ya(a) === 'symbol' ? a : String(a);
            } function Ya(a) {
              return (Ya = typeof Symbol == 'function' && J(typeof Symbol === 'function' ? Symbol.iterator : '@@iterator') == 'symbol'
                ? function (a) {
                  return J(a);
                }
                : function (a) {
                  return a && typeof Symbol == 'function' && a.constructor === Symbol && a !== (typeof Symbol === 'function' ? Symbol.prototype : '@@prototype') ? 'symbol' : J(a);
                })(a);
            } const Za = Object.prototype.toString; const $a = !('addEventListener' in g); function ab(a) {
              return Array.isArray ? Array.isArray(a) : Za.call(a) === '[object Array]';
            } function bb(a) {
              return a != null && Ya(a) === 'object' && !1 === ab(a);
            } function cb(a) {
              return !0 === bb(a) && Object.prototype.toString.call(a) === '[object Object]';
            } const db = Number.isInteger || function (a) {
              return typeof a == 'number' && isFinite(a) && Math.floor(a) === a;
            }; const eb = Object.prototype.hasOwnProperty; const fb = !{ toString: null }.propertyIsEnumerable('toString'); const gb = ['toString', 'toLocaleString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'constructor']; const hb = gb.length; function ib(a) {
              if (Ya(a) !== 'object' && (typeof a != 'function' || a === null)) {
                throw new TypeError('Object.keys called on non-object');
              } const b = []; for (var c in a) {
                eb.call(a, c) && b.push(c);
              } if (fb) {
                for (c = 0; c < hb; c++) {
                  eb.call(a, gb[c]) && b.push(gb[c]);
                }
              } return b;
            } function jb(a, b) {
              if (a == null) {
                throw new TypeError(' array is null or not defined');
              } a = Object(a); const c = a.length >>> 0; if (typeof b != 'function') {
                throw new TypeError(`${b} is not a function`);
              } for (var d = new Array(c), e = 0; e < c;) {
                var f; e in a && (f = b(a[e], e, a), d[e] = f), e++;
              } return d;
            } function kb(a) {
              if (typeof a != 'function') {
                throw new TypeError();
              } for (let b = Object(this), c = b.length >>> 0, d = arguments.length >= 2 ? arguments[1] : void 0, e = 0; e < c; e++) {
                if (e in b && a.call(d, b[e], e, b)) {
                  return !0;
                }
              } return !1;
            } function lb(a) {
              if (this == null) {
                throw new TypeError();
              } const b = Object(this); const c = b.length >>> 0; if (typeof a != 'function') {
                throw new TypeError();
              } for (var d = [], e = arguments.length >= 2 ? arguments[1] : void 0, f = 0; f < c; f++) {
                if (f in b) {
                  const g = b[f]; a.call(e, g, f, b) && d.push(g);
                }
              } return d;
            } function mb(a, b) {
              try {
                return b(a);
              } catch (a) {
                if (a instanceof TypeError) {
                  if (nb.test(a)) {
                    return null;
                  } if (ob.test(a)) {
                    return;
                  }
                } throw a;
              }
            } var nb = /^null | null$|^[^(]* null /i; var ob = /^undefined | undefined$|^[^(]* undefined /i; mb.default = mb; k = { FBSet: (function () {
              function a(b) {
                let c, d, e; !(function (a, b) {
                  if (!(a instanceof b)) {
                    throw new TypeError('Cannot call a class as a function');
                  }
                }(this, a)), c = this, e = void 0, (d = Xa('items')) in c ? Object.defineProperty(c, d, { value: e, enumerable: !0, configurable: !0, writable: !0 }) : c[d] = e, this.items = b || [];
              } let b, c, d; return b = a, (c = [{ key: 'has', value(a) {
                return kb.call(this.items, (b) => {
                  return b === a;
                });
              } }, { key: 'add', value(a) {
                this.items.push(a);
              } }]) && Wa(b.prototype, c), d && Wa(b, d), Object.defineProperty(b, 'prototype', { writable: !1 }), a;
            }()), castTo(a) {
              return a;
            }, each(a, b) {
              jb.call(this, a, b);
            }, filter(a, b) {
              return lb.call(a, b);
            }, idx: mb, isArray: ab, isEmptyObject(a) {
              return ib(a).length === 0;
            }, isInstanceOf(a, b) {
              return b != null && a instanceof b;
            }, isInteger: db, isNumber(a) {
              return typeof a == 'number' || typeof a == 'string' && /^\d+$/.test(a);
            }, isObject: bb, isPlainObject(a) {
              if (!1 === cb(a)) {
                return !1;
              } a = a.constructor; if (typeof a != 'function') {
                return !1;
              } a = a.prototype; return !1 !== cb(a) && !1 !== Object.prototype.hasOwnProperty.call(a, 'isPrototypeOf');
            }, isSafeInteger(a) {
              return db(a) && a >= 0 && a <= Number.MAX_SAFE_INTEGER;
            }, keys: ib, listenOnce(a, b, c) {
              const d = $a ? `on${b}` : b; b = $a ? a.attachEvent : a.addEventListener; const e = $a ? a.detachEvent : a.removeEventListener; b && b.call(a, d, function b() {
                e && e.call(a, d, b, !1), c();
              }, !1);
            }, map: jb, reduce(a, b, c, d) {
              if (a == null) {
                throw new TypeError(' array is null or not defined');
              } if (typeof b != 'function') {
                throw new TypeError(`${b} is not a function`);
              } const e = Object(a); const f = e.length >>> 0; let g = 0; if (c != null || !0 === d) {
                d = c;
              } else {
                for (;g < f && !(g in e);) {
                  g++;
                } if (g >= f) {
                  throw new TypeError('Reduce of empty array with no initial value');
                } d = e[g++];
              } for (;g < f;) {
                g in e && (d = b(d, e[g], g, a)), g++;
              } return d;
            }, some(a, b) {
              return kb.call(a, b);
            }, stringIncludes(a, b) {
              return a != null && b != null && a.includes(b);
            }, stringStartsWith(a, b) {
              return a != null && b != null && a.indexOf(b) === 0;
            } }; function pb(a, b) {
              const c = Object.keys(a); if (Object.getOwnPropertySymbols) {
                let d = Object.getOwnPropertySymbols(a); b && (d = d.filter((b) => {
                  return Object.getOwnPropertyDescriptor(a, b).enumerable;
                })), c.push.apply(c, d);
              } return c;
            } function qb(a) {
              for (let b = 1; b < arguments.length; b++) {
                var c = arguments[b] != null ? arguments[b] : {}; b % 2
                  ? pb(Object(c), !0).forEach((b) => {
                    rb(a, b, c[b]);
                  })
                  : Object.getOwnPropertyDescriptors
                    ? Object.defineProperties(a, Object.getOwnPropertyDescriptors(c))
                    : pb(Object(c)).forEach((b) => {
                      Object.defineProperty(a, b, Object.getOwnPropertyDescriptor(c, b));
                    });
              } return a;
            } function rb(a, b, c) {
              return (b = ub(b)) in a ? Object.defineProperty(a, b, { value: c, enumerable: !0, configurable: !0, writable: !0 }) : a[b] = c, a;
            } function sb(a) {
              return (sb = typeof Symbol == 'function' && J(typeof Symbol === 'function' ? Symbol.iterator : '@@iterator') == 'symbol'
                ? function (a) {
                  return J(a);
                }
                : function (a) {
                  return a && typeof Symbol == 'function' && a.constructor === Symbol && a !== (typeof Symbol === 'function' ? Symbol.prototype : '@@prototype') ? 'symbol' : J(a);
                })(a);
            } function tb(a, b) {
              for (let c = 0; c < b.length; c++) {
                const d = b[c]; d.enumerable = d.enumerable || !1, d.configurable = !0, 'value' in d && (d.writable = !0), Object.defineProperty(a, ub(d.key), d);
              }
            } function ub(a) {
              a = (function (a, b) {
                if (sb(a) !== 'object' || a === null) {
                  return a;
                } let c = a[typeof Symbol === 'function' ? Symbol.toPrimitive : '@@toPrimitive']; if (void 0 !== c) {
                  c = c.call(a, b || 'default'); if (sb(c) !== 'object') {
                    return c;
                  } throw new TypeError('@@toPrimitive must return a primitive value.');
                } return (b === 'string' ? String : Number)(a);
              }(a, 'string')); return sb(a) === 'symbol' ? a : String(a);
            } function vb(a, b) {
              if (!(a instanceof b)) {
                throw new TypeError('Cannot call a class as a function');
              }
            } function wb(a, b) {
              if (b && (sb(b) === 'object' || typeof b == 'function')) {
                return b;
              } if (void 0 !== b) {
                throw new TypeError('Derived constructors may only return object or undefined');
              } return (function (a) {
                if (void 0 === a) {
                  throw new ReferenceError('this hasn\'t been initialised - super() hasn\'t been called');
                } return a;
              }(a));
            } function xb(a) {
              const b = typeof Map == 'function' ? new Map() : void 0; return (xb = function (a) {
                if (a === null || (c = a, !Function.toString.call(c).includes('[native code]'))) {
                  return a;
                } let c; if (typeof a != 'function') {
                  throw new TypeError('Super expression must either be null or a function');
                } if (void 0 !== b) {
                  if (b.has(a)) {
                    return b.get(a);
                  } b.set(a, d);
                } function d() {
                  return yb(a, arguments, Bb(this).constructor);
                } return d.prototype = Object.create(a.prototype, { constructor: { value: d, enumerable: !1, writable: !0, configurable: !0 } }), Ab(d, a);
              })(a);
            } function yb(a, b, c) {
              return (yb = zb()
                ? Reflect.construct.bind()
                : function (a, b, c) {
                  const d = [null]; d.push.apply(d, b); b = new (Function.bind.apply(a, d))(); return c && Ab(b, c.prototype), b;
                }).apply(null, arguments);
            } function zb() {
              if (typeof Reflect == 'undefined' || !Reflect.construct) {
                return !1;
              } if (Reflect.construct.sham) {
                return !1;
              } if (typeof Proxy == 'function') {
                return !0;
              } try {
                return Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], () => {})), !0;
              } catch (a) {
                return !1;
              }
            } function Ab(a, b) {
              return (Ab = Object.setPrototypeOf
                ? Object.setPrototypeOf.bind()
                : function (a, b) {
                  return a.__proto__ = b, a;
                })(a, b);
            } function Bb(a) {
              return (Bb = Object.setPrototypeOf
                ? Object.getPrototypeOf.bind()
                : function (a) {
                  return a.__proto__ || Object.getPrototypeOf(a);
                })(a);
            } const Cb = k.isSafeInteger; const Db = k.reduce; const U = (function (a) {
              !(function (a, b) {
                if (typeof b != 'function' && b !== null) {
                  throw new TypeError('Super expression must either be null or a function');
                } a.prototype = Object.create(b && b.prototype, { constructor: { value: a, writable: !0, configurable: !0 } }), Object.defineProperty(a, 'prototype', { writable: !1 }), b && Ab(a, b);
              }(g, a)); let b; let c; let d; let e; const f = (b = g, c = zb(), function () {
                let a; const d = Bb(b); if (c) {
                  const e = Bb(this).constructor; a = Reflect.construct(d, arguments, e);
                } else {
                  a = d.apply(this, arguments);
                } return wb(this, a);
              }); function g() {
                let a; const b = arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : ''; return vb(this, g), (a = f.call(this, b)).name = 'PixelCoercionError', a;
              } return a = g, d && tb(a.prototype, d), e && tb(a, e), Object.defineProperty(a, 'prototype', { writable: !1 }), a;
            }(xb(Error))); function Eb() {
              return function (a) {
                if (a == null || !Array.isArray(a)) {
                  throw new U();
                } return a;
              };
            } function Fb(a, b) {
              try {
                return b(a);
              } catch (a) {
                if (a.name === 'PixelCoercionError') {
                  return null;
                } throw a;
              }
            } function V(a, b) {
              return b(a);
            } function Gb(a) {
              if (!a) {
                throw new U();
              }
            } function Hb(a) {
              const b = a.def; const c = a.validators; return function (a) {
                const d = V(a, b); return c.forEach((a) => {
                  if (!a(d)) {
                    throw new U();
                  }
                }), d;
              };
            } const Ib = /^[1-9]\d{0,25}$/; var W = { allowNull(a) {
              return function (b) {
                return b == null ? null : a(b);
              };
            }, array: Eb, arrayOf(a) {
              return function (b) {
                return V(b, W.array()).map(a);
              };
            }, assert: Gb, boolean() {
              return function (a) {
                if (typeof a != 'boolean') {
                  throw new U();
                } return a;
              };
            }, enumeration(a) {
              return function (b) {
                if ((c = a, Object.values(c)).includes(b)) {
                  return b;
                } let c; throw new U();
              };
            }, fbid() {
              return Hb({ def(a) {
                const b = Fb(a, W.number()); return b != null ? (W.assert(Cb(b)), ''.concat(b)) : V(a, W.string());
              }, validators: [function (a) {
                return Ib.test(a);
              }] });
            }, mapOf(a) {
              return function (b) {
                const c = V(b, W.object()); return Db(Object.keys(c), (b, d) => {
                  return qb(qb({}, b), {}, rb({}, d, a(c[d])));
                }, {});
              };
            }, matches(a) {
              return function (b) {
                b = V(b, W.string()); if (a.test(b)) {
                  return b;
                } throw new U();
              };
            }, number() {
              return function (a) {
                if (typeof a != 'number') {
                  throw new U();
                } return a;
              };
            }, object() {
              return function (a) {
                if (sb(a) !== 'object' || Array.isArray(a) || a == null) {
                  throw new U();
                } return a;
              };
            }, objectOrString() {
              return function (a) {
                if (sb(a) !== 'object' && typeof a != 'string' || Array.isArray(a) || a == null) {
                  throw new U();
                } return a;
              };
            }, objectWithFields(a) {
              return function (b) {
                const c = V(b, W.object()); return Db(Object.keys(a), (b, d) => {
                  if (b == null) {
                    return null;
                  } const e = a[d](c[d]); return qb(qb({}, b), {}, rb({}, d, e));
                }, {});
              };
            }, string() {
              return function (a) {
                if (typeof a != 'string') {
                  throw new U();
                } return a;
              };
            }, stringOrNumber() {
              return function (a) {
                if (typeof a != 'string' && typeof a != 'number') {
                  throw new U();
                } return a;
              };
            }, tuple(a) {
              return function (b) {
                b = V(b, Eb()); return Gb(b.length === a.length), b.map((b, c) => {
                  return V(b, a[c]);
                });
              };
            }, withValidation: Hb, func() {
              return function (a) {
                if (typeof a != 'function' || a == null) {
                  throw new U();
                } return a;
              };
            } }; D = { Typed: W, coerce: Fb, enforce: V, PixelCoercionError: U }; a = D.Typed; const Jb = a.objectWithFields({ type: a.withValidation({ def: a.number(), validators: [function (a) {
              return a >= 1 && a <= 3;
            }] }), conditions: a.arrayOf(a.objectWithFields({ targetType: a.withValidation({ def: a.number(), validators: [function (a) {
              return a >= 1 && a <= 6;
            }] }), extractor: a.allowNull(a.withValidation({ def: a.number(), validators: [function (a) {
              return a >= 1 && a <= 11;
            }] })), operator: a.withValidation({ def: a.number(), validators: [function (a) {
              return a >= 1 && a <= 4;
            }] }), action: a.withValidation({ def: a.number(), validators: [function (a) {
              return a >= 1 && a <= 4;
            }] }), value: a.allowNull(a.string()) })) }); function Kb(a) {
              const b = []; a = a; do {
                const c = a.indexOf('*'); c < 0 ? (b.push(a), a = '') : c === 0 ? (b.push('*'), a = a.slice(1)) : (b.push(a.slice(0, c)), a = a.slice(c));
              } while (a.length > 0); return b;
            }mb = function (a, b) {
              for (var a = Kb(a), b = b, c = 0; c < a.length; c++) {
                let d = a[c]; if (d !== '*') {
                  if (b.indexOf(d) !== 0) {
                    return !1;
                  } b = b.slice(d.length);
                } else {
                  if (c === a.length - 1) {
                    return !0;
                  } d = a[c + 1]; if (d === '*') {
                    continue;
                  } d = b.indexOf(d); if (d < 0) {
                    return !1;
                  } b = b.slice(d);
                }
              } return b === '';
            }; function Lb(a, b) {
              return (function (a) {
                if (Array.isArray(a)) {
                  return a;
                }
              }(a)) || (function (a, b) {
                let c = a == null ? null : typeof Symbol != 'undefined' && a[typeof Symbol === 'function' ? Symbol.iterator : '@@iterator'] || a['@@iterator']; if (c != null) {
                  let d; let e; const f = []; let g = !0; let h = !1; try {
                    if (a = (c = c.call(a)).next, b === 0) {
                      if (Object(c) !== c) {
                        return;
                      } g = !1;
                    } else {
                      for (;!(g = (d = a.call(c)).done) && (f.push(d.value), f.length !== b); g = !0) {
                        ;
                      }
                    }
                  } catch (a) {
                    h = !0, e = a;
                  } finally {
                    try {
                      if (!g && c.return != null && (d = c.return(), Object(d) !== d)) {
                        return;
                      }
                    } finally {
                      if (h) {
                        throw e;
                      }
                    }
                  } return f;
                }
              }(a, b)) || (function (a, b) {
                if (!a) {
                  return;
                } if (typeof a == 'string') {
                  return Mb(a, b);
                } let c = Object.prototype.toString.call(a).slice(8, -1); c === 'Object' && a.constructor && (c = a.constructor.name); if (c === 'Map' || c === 'Set') {
                  return Array.from(a);
                } if (c === 'Arguments' || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(c)) {
                  return Mb(a, b);
                }
              }(a, b)) || (function () {
                throw new TypeError('Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.');
              }());
            } function Mb(a, b) {
              (b == null || b > a.length) && (b = a.length); for (var c = 0, d = new Array(b); c < b; c++) {
                d[c] = a[c];
              } return d;
            } const Nb = D.enforce; const Ob = mb; const Pb = Object.freeze({ CLICK: 1, LOAD: 2, BECOME_VISIBLE: 3, TRACK: 4 }); const Qb = Object.freeze({ BUTTON: 1, PAGE: 2, JS_VARIABLE: 3, EVENT: 4, ELEMENT: 6 }); const Rb = Object.freeze({ CONTAINS: 1, EQUALS: 2, DOMAIN_MATCHES: 3, STRING_MATCHES: 4 }); const X = Object.freeze({ URL: 1, TOKENIZED_TEXT_V1: 2, TOKENIZED_TEXT_V2: 3, TEXT: 4, CLASS_NAME: 5, ELEMENT_ID: 6, EVENT_NAME: 7, DESTINATION_URL: 8, DOMAIN: 9, PAGE_TITLE: 10, IMAGE_URL: 11 }); const Sb = Object.freeze({ ALL: 1, ANY: 2, NONE: 3 }); function Tb(a, b) {
              switch (a) {
                case Pb.LOAD:return b.event === 'PageView'; case Pb.CLICK:return b.event === 'SubscribedButtonClick'; case Pb.TRACK:return !0; case Pb.BECOME_VISIBLE:default:return !1;
              }
            } function Ub(a, b, c) {
              if (b == null) {
                return null;
              } switch (a) {
                case Qb.PAGE:return (function (a, b) {
                  switch (a) {
                    case X.URL:return b.resolvedLink; case X.DOMAIN:return new URL(b.resolvedLink).hostname; case X.PAGE_TITLE:if (b.pageFeatures != null) {
                      return JSON.parse(b.pageFeatures).title.toLowerCase();
                    } break; default:return null;
                  }
                }(b, c)); case Qb.BUTTON:return (function (a, b) {
                  let c; b.buttonText != null && (c = b.buttonText.toLowerCase()); let d = {}; switch (b.buttonFeatures != null && (d = JSON.parse(b.buttonFeatures)), a) {
                    case X.DESTINATION_URL:return d.destination; case X.TEXT:return c; case X.TOKENIZED_TEXT_V1:return c == null ? null : Xb(c); case X.TOKENIZED_TEXT_V2:return c == null ? null : Yb(c); case X.ELEMENT_ID:return d.id; case X.CLASS_NAME:return d.classList; case X.IMAGE_URL:return d.imageUrl; default:return null;
                  }
                }(b, c)); case Qb.EVENT:return (function (a, b) {
                  switch (a) {
                    case X.EVENT_NAME:return b.event; default:return null;
                  }
                }(b, c)); default:return null;
              }
            } function Vb(a) {
              return a != null ? a.split('#')[0] : a;
            } function Wb(a, b) {
              a = a.replace(/[\-!$><=&_/?.,0-9:; \][%~"{})(+@^`]/g, ' '); let c = a.replace(/([A-Z])/g, ' $1').split(' '); if (c == null || c.length === 0) {
                return '';
              } a = Lb(c, 1)[0]; for (var d = 1; d < c.length; d++) {
                c[d - 1] != null && c[d] != null && c[d - 1].length === 1 && c[d].length === 1 && c[d - 1] === c[d - 1].toUpperCase() && c[d] === c[d].toUpperCase() ? a += c[d] : a += ` ${c[d]}`;
              } c = a.split(' '); if (c == null || c.length === 0) {
                return a;
              } a = ''; for (d = b ? 1 : 2, b = 0; b < c.length; b++) {
                c[b] != null && c[b].length > d && (a += `${c[b]} `);
              } return a.replace(/\s+/g, ' ');
            } function Xb(a) {
              const b = Wb(a, !0).toLowerCase().split(' '); return b.filter((a, c) => {
                return b.indexOf(a) === c;
              }).join(' ').trim();
            } function Yb(a) {
              return Wb(a, !1).toLowerCase().trim();
            } function Zb(a, b) {
              if (b.startsWith('*.')) {
                const c = b.slice(2).split('.').reverse(); const d = a.split('.').reverse(); if (c.length !== d.length) {
                  return !1;
                } for (let e = 0; e < c.length; e++) {
                  if (c[e] !== d[e]) {
                    return !1;
                  }
                } return !0;
              } return a === b;
            } function $b(a) {
              try {
                const b = new URL(a); const c = b.searchParams; return c.delete('utm_source'), c.delete('utm_medium'), c.delete('utm_campaign'), c.delete('utm_content'), c.delete('utm_term'), c.delete('utm_id'), c.delete('utm_name'), c.delete('fbclid'), c.delete('fb_action_ids'), c.delete('fb_action_types'), c.delete('fb_source'), c.delete('fb_aggregation_id'), c.sort(), `${b.origin + b.pathname}?${c.toString()}`;
              } catch (b) {
                return a;
              }
            } function ac(a, b) {
              const c = arguments.length > 2 && void 0 !== arguments[2] && arguments[2]; let d = a === b || a.toLowerCase() === unescape(encodeURIComponent(b)).toLowerCase() || Xb(a) === b || Vb(a) === Vb(b); if (!c || d) {
                return d;
              } const e = b.toLowerCase(); const f = a.toLowerCase(); return d = (d = d || f === e) || unescape(encodeURIComponent(f)).toLowerCase() === unescape(encodeURIComponent(e)).toLowerCase(), d = (d = (d = Xb(f) === e) || Vb(f) === Vb(e)) || $b(f) === $b(e);
            } function bc(a, b, c) {
              const d = arguments.length > 3 && void 0 !== arguments[3] && arguments[3]; switch (a) {
                case Rb.EQUALS:return ac(b, c, d); case Rb.CONTAINS:return c != null && c.includes(b); case Rb.DOMAIN_MATCHES:return Zb(c, b); case Rb.STRING_MATCHES:return c != null && Ob(b, c); default:return !1;
              }
            } function cc(a, b) {
              const c = arguments.length > 2 && void 0 !== arguments[2] && arguments[2]; if (!Tb(a.action, b)) {
                return !1;
              } const d = Ub(a.targetType, a.extractor, b); if (d == null) {
                return !1;
              } let e = a.value; return e != null && (a.extractor !== X.TOKENIZED_TEXT_V1 && a.extractor !== X.TOKENIZED_TEXT_V2 || (e = e.toLowerCase()), bc(a.operator, e, d, c));
            } const dc = { isMatchESTRule(a, b) {
              const c = arguments.length > 2 && void 0 !== arguments[2] && arguments[2]; let d = a; typeof a == 'string' && (d = JSON.parse(a)); for (var e = Nb(d, Jb), f = [], g = 0; g < e.conditions.length; g++) {
                f.push(cc(e.conditions[g], b, c));
              } switch (e.type) {
                case Sb.ALL:return !f.includes(!1); case Sb.ANY:return f.includes(!0); case Sb.NONE:return !f.includes(!0);
              } return !1;
            }, getKeywordsStringFromTextV1: Xb, getKeywordsStringFromTextV2: Yb, domainMatches: Zb }; const ec = D.coerce; a = D.Typed; const fc = k.each; const gc = k.filter; const hc = k.reduce; const ic = ['product', 'product_group', 'vehicle', 'automotive_model']; const jc = a.objectWithFields({ '@context': a.string(), 'additionalType': a.allowNull(a.string()), 'offers': a.allowNull(a.objectWithFields({ priceCurrency: a.allowNull(a.string()), price: a.allowNull(a.string()) })), 'productID': a.allowNull(a.string()), 'sku': a.allowNull(a.string()), '@type': a.string() }); const kc = a.objectWithFields({ '@context': a.string(), '@type': a.string(), 'item': jc }); const lc = a.objectWithFields({ '@context': a.string(), '@type': a.string(), 'itemListElement': a.array(), 'totalPrice': a.allowNull(a.string()) }); function mc(a) {
              a = ec(a, jc); if (a == null) {
                return null;
              } let b = typeof a.productID == 'string' ? a.productID : null; const c = typeof a.sku == 'string' ? a.sku : null; let d = a.offers; let e = null; let f = null; d != null && (e = qc(d.price), f = d.priceCurrency); d = typeof a.additionalType == 'string' && ic.includes(a.additionalType) ? a.additionalType : null; a = [b, c]; b = {}; return (a = gc(a, (a) => {
                return a != null;
              })).length && (b.content_ids = a), f != null && (b.currency = f), e != null && (b.value = e), d != null && (b.content_type = d), [b];
            } function nc(a) {
              a = ec(a, kc); return a == null ? null : pc([a.item]);
            } function oc(a) {
              a = ec(a, lc); if (a == null) {
                return null;
              } let b = typeof a.totalPrice == 'string' ? a.totalPrice : null; b = qc(b); a = pc(a.itemListElement); let c = null; return a != null && a.length > 0 && (c = hc(a, (a, b) => {
                b = b.value; if (b == null) {
                  return a;
                } try {
                  b = Number.parseFloat(b); return a == null ? b : a + b;
                } catch (b) {
                  return a;
                }
              }, null, !0)), a = [{ value: b }, { value: c != null ? c.toString() : null }].concat(a);
            } function pc(a) {
              let b = []; return fc(a, (c) => {
                if (a != null) {
                  const d = typeof c['@type'] == 'string' ? c['@type'] : null; if (d !== null) {
                    let e = null; switch (d) {
                      case 'Product':e = mc(c); break; case 'ItemList':e = oc(c); break; case 'ListItem':e = nc(c);
                    }e != null && (b = b.concat(e));
                  }
                }
              }), b = gc(b, (a) => {
                return a != null;
              }), fc(b, (a) => {
                fc(Object.keys(a), (b) => {
                  const c = a[b]; Array.isArray(c) && c.length > 0 || typeof c == 'string' && c !== '' || delete a[b];
                });
              }), b = gc(b, (a) => {
                return Object.keys(a).length > 0;
              });
            } function qc(a) {
              if (a == null) {
                return null;
              } a = a.replace(/\\u[\dA-F]{4}/gi, (a) => {
                a = a.replace(/\\u/g, ''); a = Number.parseInt(a, 16); return String.fromCharCode(a);
              }); if (!rc(a = (function (a) {
                a = a; if (a.length >= 3) {
                  let b = a.substring(a.length - 3); if (/((\.)(\d)(0)|(,)(0)(0))/.test(b)) {
                    let c = b.charAt(0); const d = b.charAt(1); b = b.charAt(2); d !== '0' && (c += d), b !== '0' && (c += b), c.length === 1 && (c = ''), a = a.substring(0, a.length - 3) + c;
                  }
                } return a;
              }(a = (a = (a = a.replace(/[^\d,.]/g, '')).replace(/(\.){2,}/g, '')).replace(/(,){2,}/g, ''))))) {
                return null;
              } const b = (function (a) {
                a = a; if (a == null) {
                  return null;
                } const b = (function (a) {
                  a = a.replace(/,/g, ''); return tc(sc(a), !1);
                }(a)); a = (function (a) {
                  a = a.replace(/\./g, ''); return tc(sc(a.replace(/,/g, '.')), !0);
                }(a)); if (b == null || a == null) {
                  return b != null ? b : a != null ? a : null;
                } let c = a.length; c > 0 && a.charAt(c - 1) !== '0' && (c -= 1); return b.length >= c ? b : a;
              }(a)); return b == null ? null : rc(a = b) ? a : null;
            } function rc(a) {
              return /\d/.test(a);
            } function sc(a) {
              a = a; const b = a.indexOf('.'); return b < 0 ? a : a = a.substring(0, b + 1) + a.substring(b + 1).replace(/\./g, '');
            } function tc(a, b) {
              try {
                a = Number.parseFloat(a); if (typeof (c = a) != 'number' || Number.isNaN(c)) {
                  return null;
                } c = b ? 3 : 2; return Number.parseFloat(a.toFixed(c)).toString();
              } catch (a) {
                return null;
              } let c;
            } const uc = { genCustomData: pc, reduceCustomData(a) {
              if (a.length === 0) {
                return {};
              } const b = hc(a, (a, b) => {
                return fc(Object.keys(b), (c) => {
                  let d = b[c]; const e = a[c]; if (e == null) {
                    a[c] = d;
                  } else if (Array.isArray(e)) {
                    d = Array.isArray(d) ? d : [d]; a[c] = e.concat(d);
                  }
                }), a;
              }, {}); return fc(Object.keys(b), (a) => {
                b[a], b[a] == null && delete b[a];
              }), b;
            }, getProductData: mc, getItemListData: oc, getListItemData: nc, genNormalizePrice: qc }; const vc = function (a, b) {
              const c = a.id; let d = a.tagName; const e = h(a); d = d.toLowerCase(); const f = a.className; const g = a.querySelectorAll(Ja).length; let i = null; a.tagName === 'A' && a instanceof HTMLAnchorElement && a.href ? i = a.href : b != null && b instanceof HTMLFormElement && b.action && (i = b.action), typeof i != 'string' && (i = ''); b = { classList: f, destination: i, id: c, imageUrl: Oa(a), innerText: e || '', numChildButtons: g, tag: d, type: a.getAttribute('type') }; return (a instanceof HTMLInputElement || a instanceof HTMLSelectElement || a instanceof HTMLTextAreaElement || a instanceof HTMLButtonElement) && (b.name = a.name, b.value = a.value), a instanceof HTMLAnchorElement && (b.name = a.name), b;
            }; const wc = function () {
              const a = g.querySelector('title'); return { title: T(a && a.text, 500) };
            }; const xc = function (a, b) {
              let c = a; c = a.matches || c.matchesSelector || c.mozMatchesSelector || c.msMatchesSelector || c.oMatchesSelector || c.webkitMatchesSelector || null; return c !== null && c.bind(a)(b);
            }; const yc = function (a) {
              if (a instanceof HTMLInputElement) {
                return a.form;
              } if (xc(a, La)) {
                return null;
              } for (a = t(a); a.nodeName !== 'FORM';) {
                const b = t(a.parentElement); if (b == null) {
                  return null;
                } a = b;
              } return a;
            }; const zc = function (a) {
              return Ha(a).substring(0, 200);
            }; const Ac = function (a) {
              if (f.FacebookIWL != null && f.FacebookIWL.getIWLRoot != null && typeof f.FacebookIWL.getIWLRoot == 'function') {
                const b = f.FacebookIWL.getIWLRoot(); return b && b.contains(a);
              } return !1;
            }; const Bc = 'Outbound'; const Cc = 'Download'; const Dc = ['.pdf', '.docx', '.doc', '.txt', '.jpg', '.jpeg', '.png', '.gif', '.mp3', '.wav', '.ogg', '.zip', '.rar', '.7z', '.exe', '.msi', '.xlsx', '.xls', '.pptx', '.ppt']; const Ec = function (a) {
              const b = []; const c = f.location.hostname; const d = a.getAttribute('href'); return d !== null && d !== '' && typeof d == 'string' && (d.startsWith('http://') || d.startsWith('https://')) && (new URL(d).host !== c && b.push(Bc), Dc.some((a) => {
                return d.endsWith(a);
              }) && b.push(Cc)), b;
            }; const Fc = k.filter(Ja.split(Ia), (a) => {
              return a !== 'a';
            }).join(Ia); const Gc = function a(b, c, d) {
              if (b == null || !Va(b)) {
                return null;
              } if (xc(b, c ? Ja : Fc)) {
                return b;
              } if (d && xc(b, Ka)) {
                var e = Ec(b); if (e != null && e.length > 0) {
                  return b;
                }
              }e = t(b.parentNode); return e != null ? a(e, c, d) : null;
            }; function Hc(a) {
              return a >= '0' && a <= '9';
            } function Ic(a) {
              return ',:[]/{}()\n+'.includes(a);
            } function Jc(a) {
              return a >= 'a' && a <= 'z' || a >= 'A' && a <= 'Z' || a === '_' || a === '$';
            } function Kc(a) {
              return a >= 'a' && a <= 'z' || a >= 'A' && a <= 'Z' || a === '_' || a === '$' || a >= '0' && a <= '9';
            } const Lc = /^(http|https|ftp|mailto|file|data|irc):\/\/$/; const Mc = /^[\w-.~:/?#@!$&'()*+;=]$/; function Nc(a) {
              return ',[]/{}\n+'.includes(a);
            } function Oc(a) {
              return Tc(a) || Pc.test(a);
            } var Pc = /^[[{\w-]$/; function Qc(a, b) {
              a = a.charCodeAt(b); return a === 32 || a === 10 || a === 9 || a === 13;
            } function Rc(a, b) {
              a = a.charCodeAt(b); return a === 32 || a === 9 || a === 13;
            } function Sc(a, b) {
              a = a.charCodeAt(b); return a === 160 || a >= 8192 && a <= 8202 || a === 8239 || a === 8287 || a === 12288;
            } function Tc(a) {
              return Uc(a) || Wc(a);
            } function Uc(a) {
              return a === '"' || a === '\u201C' || a === '\u201D';
            } function Vc(a) {
              return a === '"';
            } function Wc(a) {
              return a === '\'' || a === '\u2018' || a === '\u2019' || a === '`' || a === '\xB4';
            } function Xc(a) {
              return a === '\'';
            } function Yc(a, b) {
              const c = arguments.length > 2 && void 0 !== arguments[2] && arguments[2]; const d = a.lastIndexOf(b); return d !== -1 ? a.substring(0, d) + (c ? '' : a.substring(d + 1)) : a;
            } function Y(a, b) {
              let c = a.length; if (!Qc(a, c - 1)) {
                return a + b;
              } for (;Qc(a, c - 1);) {
                c--;
              } return a.substring(0, c) + b + a.substring(c);
            } function Zc(a, b, c) {
              return a.substring(0, b) + a.substring(b + c);
            } function $c(a, b) {
              let c = typeof Symbol != 'undefined' && a[typeof Symbol === 'function' ? Symbol.iterator : '@@iterator'] || a['@@iterator']; if (!c) {
                if (Array.isArray(a) || (c = (function (a, b) {
                  if (!a) {
                    return;
                  } if (typeof a == 'string') {
                    return ad(a, b);
                  } let c = Object.prototype.toString.call(a).slice(8, -1); c === 'Object' && a.constructor && (c = a.constructor.name); if (c === 'Map' || c === 'Set') {
                    return Array.from(a);
                  } if (c === 'Arguments' || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(c)) {
                    return ad(a, b);
                  }
                }(a))) || b && a && typeof a.length == 'number') {
                  c && (a = c); let g = 0; b = function () {}; return { s: b, n() {
                    return g >= a.length ? { done: !0 } : { done: !1, value: a[g++] };
                  }, e(a) {
                    throw a;
                  }, f: b };
                } throw new TypeError('Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.');
              } let d; let e = !0; let f = !1; return { s() {
                c = c.call(a);
              }, n() {
                const a = c.next(); return e = a.done, a;
              }, e(a) {
                f = !0, d = a;
              }, f() {
                try {
                  e || c.return == null || c.return();
                } finally {
                  if (f) {
                    throw d;
                  }
                }
              } };
            } function ad(a, b) {
              (b == null || b > a.length) && (b = a.length); for (var c = 0, d = new Array(b); c < b; c++) {
                d[c] = a[c];
              } return d;
            } const bd = { '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' }; const cd = { '"': '"', '\\': '\\', '/': '/', 'b': '\b', 'f': '\f', 'n': '\n', 'r': '\r', 't': '\t' }; function dd(a) {
              let b = 0; let c = ''; h(['```', '[```', '{```']), d() || (function () {
                throw new Error('Unexpected end of json string at position '.concat(a.length));
              })(), h(['```', '```]', '```}']); h = i(','); for (h && e(), Oc(a[b]) && (function (a) {
                return /[,\n][ \t\r]*$/.test(a);
              }(c))
                ? (h || (c = Y(c, ',')), (function () {
                    let a = !0; let b = !0; for (;b;) {
                      a ? a = !1 : i(',') || (c = Y(c, ',')), b = d();
                    }b || (c = Yc(c, ',')); c = '[\n'.concat(c, '\n]');
                  }()))
                : h && (c = Yc(c, ',')); a[b] === '}' || a[b] === ']';) {
                b++, e();
              } if (b >= a.length) {
                return c;
              } function d() {
                e(); const f = (function () {
                  if (a[b] !== '{') {
                    return !1;
                  } c += '{', b++, e(), v(',') && e(); let f = !0; for (;b < a.length && a[b] !== '}';) {
                    if (f ? (!0, f = !1) : (i(',') || (c = Y(c, ',')), e()), w(), !(k() || q(!0))) {
                      a[b] === '}' || a[b] === '{' || a[b] === ']' || a[b] === '[' || void 0 === a[b] ? c = Yc(c, ',') : t(); break;
                    }e(); const g = i(':'); const h = b >= a.length; g || (Oc(a[b]) || h ? c = Y(c, ':') : u()), d() || (g || h ? c += 'null' : u());
                  } return (function () {
                    a[b] === '}' ? (c += '}', b++) : c = Y(c, '}');
                  }()), !0;
                }()) || (function () {
                  if (a[b] === '[') {
                    c += '[', b++, e(), v(',') && e(); for (let f = !0; b < a.length && a[b] !== ']';) {
                      f ? f = !1 : i(',') || (c = Y(c, ',')); if (w(), !d()) {
                        c = Yc(c, ','); break;
                      }
                    } return a[b] === ']' ? (c += ']', b++) : c = Y(c, ']'), !0;
                  } return !1;
                }()) || k() || (function () {
                  let d = b; if (a[b] === '-') {
                    if (b++, r()) {
                      return s(d), !0;
                    } if (!Hc(a[b])) {
                      return b = d, !1;
                    }
                  } for (;Hc(a[b]);) {
                    b++;
                  } if (a[b] === '.') {
                    if (b++, r()) {
                      return s(d), !0;
                    } if (!Hc(a[b])) {
                      return b = d, !1;
                    } for (;Hc(a[b]);) {
                      b++;
                    }
                  } if (a[b] === 'e' || a[b] === 'E') {
                    if (b++, a[b] !== '-' && a[b] !== '+' || b++, r()) {
                      return s(d), !0;
                    } if (!Hc(a[b])) {
                      return b = d, !1;
                    } for (;Hc(a[b]);) {
                      b++;
                    }
                  } if (!r()) {
                    return b = d, !1;
                  } if (b > d) {
                    d = a.slice(d, b); const e = /^0\d/.test(d); return c += e ? '"'.concat(d, '"') : d, !0;
                  } return !1;
                }()) || p('true', 'true') || p('false', 'false') || p('null', 'null') || p('True', 'true') || p('False', 'false') || p('None', 'null') || q(!1) || (function () {
                  if (a[b] === '/') {
                    const d = b; for (b++; b < a.length && (a[b] !== '/' || a[b - 1] === '\\');) {
                      b++;
                    } return b++, c += '"'.concat(a.substring(d, b), '"'), !0;
                  }
                }()); return e(), f;
              } function e() {
                const a = !(arguments.length > 0 && void 0 !== arguments[0]) || arguments[0]; const c = b; let d; f(a); do {
                  (d = g()) && (d = f(a));
                } while (d); return b > c;
              } function f(d) {
                for (var d = d ? Qc : Rc, e = ''; ;) {
                  if (d(a, b)) {
                    e += a[b], b++;
                  } else {
                    if (!Sc(a, b)) {
                      break;
                    } e += ' ', b++;
                  }
                } return e.length > 0 && (c += e, !0);
              } function g() {
                if (a[b] === '/' && a[b + 1] === '*') {
                  for (;b < a.length && !ed(a, b);) {
                    b++;
                  } return b += 2, !0;
                } if (a[b] === '/' && a[b + 1] === '/') {
                  for (;b < a.length && a[b] !== '\n';) {
                    b++;
                  } return !0;
                } return !1;
              } function h(c) {
                if (function (c) {
                  let d; c = $c(c); try {
                    for (c.s(); !(d = c.n()).done;) {
                      d = d.value; const e = b + d.length; if (a.slice(b, e) === d) {
                        return b = e, !0;
                      }
                    }
                  } catch (a) {
                    c.e(a);
                  } finally {
                    c.f();
                  } return !1;
                }(c)) {
                  if (Jc(a[b])) {
                    for (;b < a.length && Kc(a[b]);) {
                      b++;
                    }
                  } return e(), !0;
                } return !1;
              } function i(d) {
                return a[b] === d && (c += a[b], b++, !0);
              } function v(c) {
                return a[b] === c && (b++, !0);
              } function j() {
                return v('\\');
              } function w() {
                return e(), a[b] === '.' && a[b + 1] === '.' && a[b + 2] === '.' && (b += 3, e(), v(','), !0);
              } function k() {
                const d = arguments.length > 0 && void 0 !== arguments[0] && arguments[0]; const e = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : -1; let f = a[b] === '\\'; if (f && (b++, f = !0), !Tc(a[b])) {
                  return !1;
                } const g = Vc(a[b]) ? Vc : Xc(a[b]) ? Xc : Wc(a[b]) ? Wc : Uc; const h = b; const i = c.length; let k = '"'; for (b++; ;) {
                  const s = { str: k, stopAtDelimiter: d, iBefore: h, oBefore: i, stopAtIndex: e, isEndQuote: g }; const t = x(s); if (t !== null) {
                    return t;
                  } const o = l(s); if (o !== null) {
                    return o;
                  } const p = y(s); if (p !== null) {
                    if (p.shouldContinue) {
                      k = p.str; continue;
                    } return p.result;
                  } const q = m(s); if (q !== null) {
                    return q;
                  } const r = z(k); k = r !== null ? r : n(k), f && j();
                }
              } function x(d) {
                if (b >= a.length) {
                  const e = d.str; let f = d.stopAtDelimiter; const g = d.iBefore; d = d.oBefore; const h = A(b - 1); if (!f && Ic(a.charAt(h))) {
                    return b = g, c = c.substring(0, d), k(!0);
                  } f = Y(e, '"'); return c += f, !0;
                } return null;
              } function l(a) {
                if (b === a.stopAtIndex) {
                  a = Y(a.str, '"'); return c += a, !0;
                } return null;
              } function y(d) {
                if (d.isEndQuote(a[b])) {
                  let f = d.str; let g = d.stopAtDelimiter; const h = d.iBefore; d = d.oBefore; const i = b; const j = f.length; f = `${f}"`; if (b++, c += f, e(!1), g || b >= a.length || Ic(a[b]) || Tc(a[b]) || Hc(a[b])) {
                    return o(), { result: !0, shouldContinue: !1 };
                  } g = A(i - 1); const l = a.charAt(g); return l === ',' ? (b = h, c = c.substring(0, d), { result: k(!1, g), shouldContinue: !1 }) : Ic(l) ? (b = h, c = c.substring(0, d), { result: k(!0), shouldContinue: !1 }) : (c = c.substring(0, d), b = i + 1, { str: ''.concat(f.substring(0, j), '\\').concat(f.substring(j)), shouldContinue: !0 });
                } return null;
              } function m(d) {
                if (d.stopAtDelimiter && Nc(a[b])) {
                  let e = d.iBefore; d = d.str; if (a[b - 1] === ':' && Lc.test(a.substring(e + 1, b + 2))) {
                    for (;b < a.length && Mc.test(a[b]);) {
                      d += a[b], b++;
                    }
                  }e = Y(d, '"'); return c += e, o(), !0;
                } return null;
              } function z(c) {
                if (a[b] === '\\') {
                  const d = a.charAt(b + 1); if (void 0 !== cd[d]) {
                    c += a.slice(b, b + 2), b += 2;
                  } else if (d === 'u') {
                    for (var e = 2; e < 6 && (f = a[b + e], /^[0-9A-F]$/i.test(f));) {
                      e++;
                    }e === 6
                      ? (c += a.slice(b, b + 6), b += 6)
                      : b + e >= a.length
                        ? b = a.length
                        : (function () {
                            const c = a.slice(b, b + 6); throw new Error('Invalid unicode character "'.concat(c, '" at position ').concat(b));
                          })();
                  } else {
                    c += d, b += 2;
                  } return c;
                } let f; return null;
              } function n(c) {
                let d; const e = a.charAt(b); return e === '"' && a[b - 1] !== '\\'
                  ? (c += '\\'.concat(e), b++)
                  : (d = e) === '\n' || d === '\r' || d === '\t' || d === '\b' || d === '\f'
                      ? (c += bd[e], b++)
                      : (e >= ' ' || (function (a) {
                          throw new Error('Invalid character '.concat(JSON.stringify(a), ' at position ').concat(b));
                        }(e)), c += e, b++), c;
              } function o() {
                let d = !1; for (e(); a[b] === '+';) {
                  d = !0, b++, e(); const f = (c = Yc(c, '"', !0)).length; const g = k(); c = g ? Zc(c, f, 1) : Y(c, '"');
                } return d;
              } function p(d, e) {
                return a.slice(b, b + d.length) === d && (c += e, b += d.length, !0);
              } function q(e) {
                const f = b; if (Jc(a[b])) {
                  for (;b < a.length && Kc(a[b]);) {
                    b++;
                  } for (var g = b; Qc(a, g);) {
                    g++;
                  } if (a[g] === '(') {
                    return b = g + 1, d(), a[b] === ')' && (b++, a[b] === ';' && b++), !0;
                  }
                } if ((function (c, d) {
                  for (;b < a.length && !Nc(a[b]) && !Tc(a[b]) && (!d || a[b] !== ':');) {
                    b++;
                  } if (a[b - 1] === ':' && Lc.test(a.substring(c, b + 2))) {
                    for (;b < a.length && Mc.test(a[b]);) {
                      b++;
                    }
                  }
                }(f, e)), b > f) {
                  for (;Qc(a, b - 1) && b > 0;) {
                    b--;
                  }g = a.slice(f, b); return c += g === 'undefined' ? 'null' : JSON.stringify(g), a[b] === '"' && b++, !0;
                }
              } function A(b) {
                for (b = b; b > 0 && Qc(a, b);) {
                  b--;
                } return b;
              } function r() {
                return b >= a.length || Ic(a[b]) || Qc(a, b);
              } function s(d) {
                c += ''.concat(a.slice(d, b), '0');
              } function t() {
                throw new Error('Object key expected at position '.concat(b));
              } function u() {
                throw new Error('Colon expected at position '.concat(b));
              }!(function () {
                throw new Error('Unexpected character '.concat(JSON.stringify(a[b]), ' at position ').concat(b));
              }());
            } function ed(a, b) {
              return a[b] === '*' && a[b + 1] === '/';
            } function fd(a) {
              return (fd = typeof Symbol == 'function' && J(typeof Symbol === 'function' ? Symbol.iterator : '@@iterator') == 'symbol'
                ? function (a) {
                  return J(a);
                }
                : function (a) {
                  return a && typeof Symbol == 'function' && a.constructor === Symbol && a !== (typeof Symbol === 'function' ? Symbol.prototype : '@@prototype') ? 'symbol' : J(a);
                })(a);
            } function gd(a) {
              return (function (a) {
                if (Array.isArray(a)) {
                  return hd(a);
                }
              }(a)) || (function (a) {
                if (typeof Symbol != 'undefined' && a[typeof Symbol === 'function' ? Symbol.iterator : '@@iterator'] != null || a['@@iterator'] != null) {
                  return Array.from(a);
                }
              }(a)) || (function (a, b) {
                if (!a) {
                  return;
                } if (typeof a == 'string') {
                  return hd(a, b);
                } let c = Object.prototype.toString.call(a).slice(8, -1); c === 'Object' && a.constructor && (c = a.constructor.name); if (c === 'Map' || c === 'Set') {
                  return Array.from(a);
                } if (c === 'Arguments' || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(c)) {
                  return hd(a, b);
                }
              }(a)) || (function () {
                throw new TypeError('Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.');
              }());
            } function hd(a, b) {
              (b == null || b > a.length) && (b = a.length); for (var c = 0, d = new Array(b); c < b; c++) {
                d[c] = a[c];
              } return d;
            } function id(a, b) {
              const c = Object.keys(a); if (Object.getOwnPropertySymbols) {
                let d = Object.getOwnPropertySymbols(a); b && (d = d.filter((b) => {
                  return Object.getOwnPropertyDescriptor(a, b).enumerable;
                })), c.push.apply(c, d);
              } return c;
            } function jd(a, b, c) {
              return (b = (function (a) {
                a = (function (a, b) {
                  if (fd(a) !== 'object' || a === null) {
                    return a;
                  } let c = a[typeof Symbol === 'function' ? Symbol.toPrimitive : '@@toPrimitive']; if (void 0 !== c) {
                    c = c.call(a, b || 'default'); if (fd(c) !== 'object') {
                      return c;
                    } throw new TypeError('@@toPrimitive must return a primitive value.');
                  } return (b === 'string' ? String : Number)(a);
                }(a, 'string')); return fd(a) === 'symbol' ? a : String(a);
              }(b))) in a
                ? Object.defineProperty(a, b, { value: c, enumerable: !0, configurable: !0, writable: !0 })
                : a[b] = c, a;
            } const kd = k.each; const ld = k.filter; const md = k.FBSet; const nd = ['og:image']; const od = [{ property: 'image', type: 'Product' }]; const pd = ['gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14', 'isbn']; const qd = ['product', 'https://schema.org/product', 'http://schema.org/product']; const rd = ['offer', 'https://schema.org/offer', 'http://schema.org/offer']; const sd = ['aggregateoffer', 'https://schema.org/aggregateoffer', 'http://schema.org/aggregateoffer']; const td = ['aggregaterating', 'https://schema.org/aggregaterating', 'http://schema.org/aggregaterating']; const ud = ['mpn']; const vd = ['name']; const wd = ['description']; const xd = ['aggregaterating']; const yd = ['availability']; const zd = ['price', 'lowprice']; const Ad = ['pricecurrency']; const Bd = ['sku', 'productid', '@id']; const Cd = ['offers', 'offer']; const Dd = ['pricespecification']; const Ed = ['url']; function Fd(a) {
              return ld(nd, (b) => {
                return b === a;
              })[0] != null;
            } function Gd(a, b) {
              return ld(od, (c) => {
                return (a === 'https://schema.org/'.concat(c.type) || a === 'http://schema.org/'.concat(c.type)) && c.property === b;
              })[0] != null;
            } function Hd(a) {
              return Object.keys(a).length === 0;
            } function Id(a) {
              for (var b = { automaticParameters: {}, productID: null, productUrl: null, productContents: [], productUrls: [] }, c = 0; c < a.length; c++) {
                const d = a[c]; b.automaticParameters = Jd(b.automaticParameters, d.automaticParameters), b.productContents = Kd(b.productContents, d.productContents), d.productUrls != null && (b.productUrls = b.productUrls.concat(d.productUrls)), d.productID != null && b.productID == null && (b.productID = d.productID), d.productUrl != null && b.productUrl == null && (b.productUrl = d.productUrl);
              } return b;
            } function Jd(a, b) {
              return b.currency != null && (a.currency = b.currency), b.contents != null && Array.isArray(b.contents) && (a.contents == null ? a.contents = b.contents : a.contents = a.contents.concat(b.contents)), a;
            } function Kd(a, b) {
              return a == null ? b || [] : b == null ? a || [] : a.concat(b);
            } function Ld(a, b) {
              a = a.getAttribute(b); return a == null || typeof a != 'string' ? '' : a;
            } function Md(a, b) {
              const c = []; return b.forEach((b) => {
                if (b != null) {
                  const d = (function (a) {
                    for (let b = 1; b < arguments.length; b++) {
                      var c = arguments[b] != null ? arguments[b] : {}; b % 2
                        ? id(Object(c), !0).forEach((b) => {
                          jd(a, b, c[b]);
                        })
                        : Object.getOwnPropertyDescriptors
                          ? Object.defineProperties(a, Object.getOwnPropertyDescriptors(c))
                          : id(Object(c)).forEach((b) => {
                            Object.defineProperty(a, b, Object.getOwnPropertyDescriptor(c, b));
                          });
                    } return a;
                  }({}, a)); d.id = b, c.push(d);
                }
              }), c.length !== 0 || Hd(a) || c.push(a), c;
            } function Nd() {
              let a = g.querySelectorAll('[itemscope]'); if (a.length === 0) {
                return {};
              } a = ld(a, (a) => {
                return qd.includes(Ld(a, 'itemtype').toLowerCase());
              }); if (a.length === 0) {
                return {};
              } let b = {}; return a.forEach((a) => {
                b = Jd(b, (function (a) {
                  let b = null; let c = null; let d = null; let e = null; const f = [{ itempropsLowerCase: ['price'], property: 'item_price', apply(a) {
                    return fe(a);
                  }, getDefualt() {
                    return null;
                  }, setDefault(a) {} }, { itempropsLowerCase: ['availability'], property: 'availability', apply(a) {
                    return ke(a);
                  }, getDefualt() {
                    return null;
                  }, setDefault(a) {} }, { itempropsLowerCase: ['mpn'], property: 'mpn', apply(a) {
                    return a;
                  }, getDefualt() {
                    return c;
                  }, setDefault(a) {
                    c = a;
                  } }, { itempropsLowerCase: pd, property: 'gtin', apply(a) {
                    return a;
                  }, getDefualt() {
                    return d;
                  }, setDefault(a) {
                    d = a;
                  } }, { itempropsLowerCase: ['productid', 'sku', 'product_id'], property: 'id', apply(a) {
                    return a;
                  }, getDefualt() {
                    return b;
                  }, setDefault(a) {
                    b = a;
                  } }, { itempropsLowerCase: ['pricecurrency'], property: 'currency', apply(a) {
                    return null;
                  }, getDefualt() {
                    return e;
                  }, setDefault(a) {
                    e = a;
                  } }]; a.querySelectorAll('[itemprop]').forEach((a) => {
                    const b = a.getAttribute('itemprop'); if (typeof b == 'string' && b !== '') {
                      const c = i(a); c != null && c !== '' && f.forEach((a) => {
                        const d = a.setDefault; const e = a.itempropsLowerCase; a.getDefualt() == null && e.includes(b.toLowerCase()) && d(c);
                      });
                    }
                  }); a = ld(a.querySelectorAll('[itemscope]'), (a) => {
                    return rd.includes(Ld(a, 'itemtype').toLowerCase());
                  }); const g = []; a.forEach((a) => {
                    const b = {}; a.querySelectorAll('[itemprop]').forEach((a) => {
                      const c = a.getAttribute('itemprop'); if (typeof c == 'string' && c !== '') {
                        const d = i(a); d != null && d !== '' && f.forEach((a) => {
                          const e = a.apply; const f = a.property; if (a.itempropsLowerCase.includes(c.toLowerCase())) {
                            a = e(d); Z(b, f, a);
                          }
                        });
                      }
                    }), g.push(b);
                  }), g.forEach((a) => {
                    Z(a, 'mpn', a.mpn ? a.mpn : c), Z(a, 'gtin', a.gtin ? a.gtin : d), Z(a, 'id', a.id ? a.id : b);
                  }); a = { currency: e }; return de(a, !0, g), a;
                }(a)));
              }), b;
            } function Od() {
              const a = arguments.length > 0 && void 0 !== arguments[0] && arguments[0]; const b = arguments.length > 2 && void 0 !== arguments[2] && arguments[2]; const c = g.querySelectorAll('[itemscope]'); const d = []; const e = Pd(c); const f = {}; const h = {}; const i = { automaticParameters: {}, productID: null, productUrl: null, productContents: [] }; const j = a ? Nd() : {}; const k = Qd({ scopes: c, seenProperties: e, scopeSchemas: d, productMetadata: i, contentData: f, includeAutomaticParameters: a, productContentData: h, includeProductContent: b }); const m = k.localProductID; const l = k.SKU; Td(i, m, l), j.contents == null && (j.contents = []), j.contents.push(f), de(i.automaticParameters, a, j.contents), ee(i.productContents, b, [h]); const n = Ud(d); return { extractedProperties: n, productMetadata: i };
            } function Pd(a) {
              for (var b = new md(), c = 0; c < a.length; c++) {
                b.add(a[c]);
              } return b;
            } function Qd(a) {
              for (var b = a.scopes, c = a.seenProperties, d = a.scopeSchemas, e = a.productMetadata, f = a.contentData, g = a.includeAutomaticParameters, h = a.productContentData, a = a.includeProductContent, p = null, j = null, q = b.length - 1; q >= 0; q--) {
                const k = b[q]; const r = k.getAttribute('itemtype'); if (typeof r == 'string' && r !== '') {
                  for (var l = {}, s = k.querySelectorAll('[itemprop]'), m = 0; m < s.length; m++) {
                    let t = s[m]; if (!c.has(t)) {
                      c.add(t); const n = t.getAttribute('itemprop'); if (typeof n == 'string' && n !== '') {
                        t = i(t); if (t != null && t !== '') {
                          const o = l[n]; o != null && Gd(r, n) ? Array.isArray(o) ? l[n].push(t) : l[n] = [o, t] : (e.productID == null && (n === 'productID' ? p = t : n === 'sku' && (j = t)), e.productUrl == null && n === 'url' && (e.productUrl = t), a && Rd(h, r, n, t), g && Sd(f, e, n, t), l[n] = t);
                        }
                      }
                    }
                  }d.unshift({ schema: { dimensions: { h: k.clientHeight, w: k.clientWidth }, properties: l, subscopes: [], type: r }, scope: k });
                }
              } return { localProductID: p, SKU: j };
            } function Rd(a, b, c, d) {
              c !== 'productID' && c !== 'sku' || (a.ids == null ? a.ids = [d] : a.ids.includes(d) || a.ids.push(d)), qd.includes(b.toLowerCase()) && c === 'name' && (a.name = d), qd.includes(b.toLowerCase()) && c === 'description' && (a.description = d), td.includes(b.toLowerCase()) && (a.aggregate_rating == null && (a.aggregate_rating = {}), c === 'ratingValue' ? a.aggregate_rating.ratingValue = d : c === 'ratingCount' ? a.aggregate_rating.ratingCount = d : c === 'reviewCount' ? a.aggregate_rating.reviewCount = d : c === 'bestRating' ? a.aggregate_rating.bestRating = d : c === 'worstRating' && (a.aggregate_rating.worstRating = d));
            } function Sd(a, b, c, d) {
              b.automaticParameters.currency == null && c === 'priceCurrency' && (b.automaticParameters.currency = d), a.id != null || c !== 'productID' && c !== 'sku' || (a.id = d), a.mpn == null && c === 'mpn' && (a.mpn = d), a.gtin == null && pd.includes(c) && (a.gtin = d), a.item_price == null && c === 'price' && Z(a, 'item_price', fe(d)), a.availability == null && c === 'availability' && Z(a, 'availability', ke(d));
            } function Td(a, b, c) {
              b != null ? a.productID = b : c != null && (a.productID = c);
            } function Ud(a) {
              for (var b = [], c = [], d = 0; d < a.length; d++) {
                for (var e = a[d], f = e.scope, e = e.schema, g = c.length - 1; g >= 0; g--) {
                  if (c[g].scope.contains(f)) {
                    c[g].schema.subscopes.push(e); break;
                  }c.pop();
                }c.length === 0 && b.push(e), c.push({ schema: e, scope: f });
              } return b;
            } function Vd(a, b) {
              if (a == null) {
                return { content: {}, currency: null };
              } const c = {}; const d = (function (a) {
                const b = { price: null, currency: null }; if (a == null) {
                  return b;
                } b.price = fe($(a, zd)), b.currency = $(a, Ad); a = (function (a) {
                  const b = { price: null, currency: null }; if (a == null) {
 return b; 
} if (!Array.isArray(a)) {
 return b.price = fe($(a, zd)), b.currency = $(a, Ad), b; 
} return a.length === 0
                    ? b
                    : (kd(a, (a) => {
                        a.priceCurrency != null && (b.currency = $(a, Ad)), b.price = (function (a, b) {
                          if (a == null) { return b; } return b == null ? a : a > b ? b : a;
                        }(fe($(a, zd)), b.price));
                      }), b);
                }($(a, Dd))); b.price == null && (b.price = a.price); b.currency == null && (b.currency = a.currency); return b;
              }(a)); const e = $(a, ud, b.mpn); const f = $(a, pd, b.gtin); return Z(c, 'mpn', e), Z(c, 'gtin', f), Z(c, 'item_price', d.price), Z(c, 'availability', ke($(a, yd))), { content: Md(c, (function (a, b) {
                const c = arguments.length > 2 && void 0 !== arguments[2] ? arguments[2] : null; const d = []; c && d.push(c); if (fd(a) !== 'object') {
                  return d;
                } const e = []; return kd(Object.keys(a), (c) => {
                  b.includes(c.toLowerCase()) && a[c] && e.push(a[c]);
                }), e.length > 0 ? e : d;
              }(a, Bd, b.id))), currency: d.currency };
            } function Wd() {
              for (var a = arguments.length > 0 && void 0 !== arguments[0] && arguments[0], b = arguments.length > 1 && void 0 !== arguments[1] && arguments[1], c = arguments.length > 2 ? arguments[2] : void 0, d = arguments.length > 3 && void 0 !== arguments[3] && arguments[3], e = { automaticParameters: {}, productID: null, productUrl: null, productContents: [] }, f = [], h = [], i = g.querySelectorAll('script[type="application/ld+json"]'), j = 0, k = [], r = {}, l = 0; l < i.length; l++) {
                const s = i[l].innerText; if (s != null && s !== '') {
                  try {
                    if ((j += s.length) > 12e4) {
                      return de(e.automaticParameters, a, k), ee(e.productContents, d, [r]), { extractedProperties: f, invalidInnerTexts: h, productMetadata: e };
                    } for (let m = Xd(s, b), t = 0; t < m.length; t++) {
                      const n = m[t]; be(m, $(n, ['mainentity'])), be(m, $(n, ['@graph'])), be(m, $(n, ['hasvariant'])); const u = {}; const o = Yd({ json: n, productMetadata: e, contentData: u, includeAutomaticParameters: a, productContentData: r, includeProductContent: d, logInfo: c }); const v = o.isTypeProduct; const p = o.offers; if ((e.productUrl == null || v) && p != null) {
                        const q = $d({ offers: p, productMetadata: e, contentData: u, includeAutomaticParameters: a, productContentData: r, includeProductContent: d, logInfo: c }); k = k.concat(q);
                      }f.push(n);
                    }
                  } catch (a) {
                    h.push(s);
                  }
                }
              } return de(e.automaticParameters, a, k), ee(e.productContents, d, [r]), { extractedProperties: f, invalidInnerTexts: h, productMetadata: e };
            } function Xd(a, b) {
              let c = null; c = ne(a); try {
                c = JSON.parse(c.replace(/[\n\r\t]+/g, ' '));
              } catch (a) {
                if (!b) {
                  throw a;
                } c = oe(c), c = JSON.parse(c.replace(/[\n\r\t]+/g, ' '));
              } return Array.isArray(c) || (c = [c]), c;
            } function Yd(a) {
              const b = a.json; const c = a.productMetadata; const d = a.contentData; const e = a.includeAutomaticParameters; const f = a.productContentData; a = a.includeProductContent; let g = ce(b); g = qd.includes(g); const h = $(b, Cd); if (!g) {
                return { isTypeProduct: g, offers: h };
              } const i = $(b, Bd); return c.productID != null && c.productID !== '' || (c.productID = i), e && (Z(d, 'id', i), Z(d, 'mpn', $(b, ud)), Z(d, 'gtin', $(b, pd))), a && (i && (f.ids == null ? f.ids = [i] : f.ids.includes(i) || f.ids.push(i)), Z(f, 'name', $(b, vd)), Z(f, 'description', $(b, wd)), Z(f, 'aggregate_rating', $(b, xd))), ae(b, c), Zd(b, c), { isTypeProduct: g, offers: h };
            } function Zd(a, b) {
              a = $(a, Ed); a != null && a !== '' && (b.productUrls == null && (b.productUrls = []), b.productUrls.push(a));
            } function $d(a) {
              const b = a.offers; const c = a.productMetadata; const d = a.contentData; const e = a.includeAutomaticParameters; const f = a.productContentData; const g = a.includeProductContent; let h = []; a = []; if (Array.isArray(b)) {
                a = b;
              } else {
                let i = ce(b); const j = rd.includes(i); i = sd.includes(i); (j || i) && (a = [b]);
              } return a.length === 0 || kd(a, (a) => {
                if (ae(a, c), Zd(a, c), e) {
                  const b = Vd(a, d); c.automaticParameters.currency == null && (c.automaticParameters.currency = b.currency), h = h.concat(b.content);
                }g && (function (a, b) {
                  if (a != null) {
                    a = $(a, Bd); a != null && (b.ids == null ? b.ids = [a] : b.ids.includes(a) || b.ids.push(a));
                  }
                })(a, f);
              }), h;
            } function ae(a, b) {
              a = $(a, Ed); b.productUrl != null && b.productUrl !== '' || (b.productUrl = a);
            } function be(a, b) {
              if (b != null) {
                let c = b; Array.isArray(b) || (c = [b]), a.push.apply(a, gd(c));
              }
            } function ce(a) {
              return a == null ? '' : typeof a['@type'] == 'string' && a['@type'] != null ? a['@type'].toLowerCase() : '';
            } function de(a, b, c) {
              if (b) {
                b = c.filter((a) => {
                  return !Hd(a);
                }); b.length !== 0 && (a.contents = b);
              }
            } function ee(a, b, c) {
              if (b) {
                b = c.filter((a) => {
                  return !Hd(a);
                }); b.length !== 0 && a.push.apply(a, gd(b));
              }
            } function fe(a) {
              if (typeof a == 'string') {
                const b = Number.parseFloat(a.replace(/[^0-9.]/g, '')); return isNaN(b) ? null : b;
              } return typeof a == 'number' ? a : null;
            } function Z(a, b, c) {
              c != null && (a[b] = c);
            } function $(a, b) {
              const c = arguments.length > 2 && void 0 !== arguments[2] ? arguments[2] : null; if (fd(a) !== 'object') {
                return c;
              } const d = Object.keys(a); const e = {}; kd(d, (c) => {
                b.includes(c.toLowerCase()) && (e[c.toLowerCase()] = a[c]);
              }); const f = b.find((a) => {
                return e[a];
              }); return f ? e[f] : c;
            } function ge(a, b, c) {
              c.name != null || a !== 'product:name' && a !== 'og:title' || (c.name = b), c.description != null || a !== 'product:description' && a !== 'og:description' || (c.description = b), a !== 'product:retailer_item_id' && a !== 'product:sku' || (c.ids == null ? c.ids = [b] : c.ids.includes(b) || c.ids.push(b));
            } function he(a, b, c, d) {
              c.automaticParameters.currency != null || a !== 'product:price:currency' && a !== 'og:price:currency' || (c.automaticParameters.currency = b), d.id != null || a !== 'product:retailer_item_id' && a !== 'product:sku' || (d.id = b), d.mpn == null && a === 'product:mfr_part_no' && (d.mpn = b), d.gtin == null && pd.map((a) => {
                return 'product:'.concat(a);
              }).includes(a) && (d.gtin = b), d.item_price != null || a !== 'product:price:amount' && a !== 'og:price:amount' || Z(d, 'item_price', fe(b)), d.availability != null || a !== 'product:availability' && a !== 'og:availability' || Z(d, 'availability', ke(b));
            } function ie(a, b, c, d, e, f, g) {
              const h = arguments.length > 7 && void 0 !== arguments[7] && arguments[7]; let i = null; let j = null; let l = !1; const k = c[a]; return k != null && Fd(a) ? Array.isArray(k) ? c[a].push(b) : c[a] = [k, b] : (b && (d.productID != null && d.productID !== '' || (a === 'product:retailer_item_id' && (i = b, l = !0), a === 'product:sku' && (j = b, l = !0)), d.productUrl != null && d.productUrl !== '' || a !== 'og:url' || (d.productUrl = b), a === 'og:type' && b.toLowerCase().includes('product') && (l = !0), h && ge(a, b, g), f && he(a, b, d, e)), c[a] = b), { productRetailerItemID: i, productSKU: j, isProduct: l };
            } function je() {
              for (var a = arguments.length > 0 && void 0 !== arguments[0] && arguments[0], b = arguments.length > 2 && void 0 !== arguments[2] && arguments[2], c = { automaticParameters: {}, productID: null, productUrl: null, productContents: [] }, d = new md(['og', 'product', 'music', 'video', 'article', 'book', 'profile', 'website', 'twitter']), e = {}, f = null, h = null, i = !1, j = {}, k = {}, o = g.querySelectorAll('meta[property]'), l = 0; l < o.length; l++) {
                const p = o[l]; const m = p.getAttribute('property'); const q = p.getAttribute('content'); if (typeof m == 'string' && m.includes(':') && typeof q == 'string' && d.has(m.split(':')[0])) {
                  const n = T(q, 500); const r = ie(m, n, e, c, j, a, k, b); r.productRetailerItemID && (f = r.productRetailerItemID), r.productSKU && (h = r.productSKU), !0 === r.isProduct && (i = !0);
                }
              } return f != null ? c.productID = f : h != null && (c.productID = h), de(c.automaticParameters, a, [j]), i && ee(c.productContents, b, [k]), { extractedProperties: e, productMetadata: c };
            } function ke(a) {
              if (typeof a != 'string' && !(a instanceof String)) {
                return null;
              } a = a.split('/'); return a.length > 0 ? a[a.length - 1] : '';
            } const le = { description: !0, keywords: !0 }; function me() {
              const a = arguments.length > 0 && void 0 !== arguments[0] && arguments[0]; const b = g.querySelector('title'); const c = { title: T(b && (b.textContent || b.innerText), 500) }; if (a) {
                return c;
              } for (let d = g.querySelectorAll('meta[name]'), e = 0; e < d.length; e++) {
                const f = d[e]; const h = f.getAttribute('name'); const i = f.getAttribute('content'); typeof h == 'string' && typeof i == 'string' && le[h] && (c[h] = T(i, 500));
              } return c;
            } function ne(a) {
              return a == null
                ? null
                : a.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (a, b) => {
                  return b ? '' : a;
                });
            } function oe(a) {
              if (a == null) {
                return null;
              } try {
                return dd(a);
              } catch (b) {
                return a;
              }
            }c.d(b, 'inferredEventsSharedUtils', () => {
              return pe;
            }), c.d(b, 'MicrodataExtractionMethods', () => {
              return qe;
            }), c.d(b, 'getJsonLDForExtractors', () => {
              return Ba;
            }), c.d(b, 'getParameterExtractorFromGraphPayload', () => {
              return Ca;
            }), c.d(b, 'unicodeSafeTruncate', () => {
              return T;
            }), c.d(b, 'signalsGetTextFromElement', () => {
              return h;
            }), c.d(b, 'signalsGetTextOrValueFromElement', () => {
              return Ha;
            }), c.d(b, 'signalsGetValueFromHTMLElement', () => {
              return i;
            }), c.d(b, 'signalsGetButtonImageUrl', () => {
              return Oa;
            }), c.d(b, 'signalsIsSaneButton', () => {
              return Va;
            }), c.d(b, 'signalsConvertNodeToHTMLElement', () => {
              return t;
            }), c.d(b, 'SignalsESTRuleEngine', () => {
              return dc;
            }), c.d(b, 'SignalsESTCustomData', () => {
              return uc;
            }), c.d(b, 'signalsExtractButtonFeatures', () => {
              return vc;
            }), c.d(b, 'signalsExtractPageFeatures', () => {
              return wc;
            }), c.d(b, 'signalsExtractForm', () => {
              return yc;
            }), c.d(b, 'signalsGetTruncatedButtonText', () => {
              return zc;
            }), c.d(b, 'signalsIsIWLElement', () => {
              return Ac;
            }), c.d(b, 'signalsGetWrappingButton', () => {
              return Gc;
            }), c.d(b, 'signalsGetButtonActionType', () => {
              return Ec;
            }); var pe = d; var qe = e;
          }]));
        })(); return j.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsShouldRestrictReferrerEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsParamList'); const b = f.getFbeventsModules('SignalsFBEventsBaseEvent'); let c = f.getFbeventsModules('SignalsFBEventsTyped'); c.coerce; c.Typed; f.getFbeventsModules('SignalsFBEventsPixelTypedef'); c = f.getFbeventsModules('SignalsFBEventsCoercePrimitives'); c.coerceString; function d(b) {
            b = b instanceof a ? b : null; return b != null ? [b] : null;
          }c = new b(d); k.exports = c;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsStandardParamChecksConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); const b = a.Typed; a.coerce; a = b.objectWithFields({ standardParamChecks: b.allowNull(b.mapOf(b.allowNull(b.arrayOf(b.allowNull(b.objectWithFields({ require_exact_match: b.boolean(), potential_matches: b.allowNull(b.arrayOf(b.string())) })))))) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsTelemetry', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsLogging'); const b = f.getFbeventsModules('SignalsParamList'); f.getFbeventsModules('SignalsFBEventsQE'); const c = f.getFbeventsModules('signalsFBEventsSendGET'); f.getFbeventsModules('signalsFBEventsSendBeacon'); const d = 0.01; const e = Math.random(); const h = g.fbq && g.fbq._releaseSegment ? g.fbq._releaseSegment : 'unknown'; const i = e < d || h === 'canary'; const j = 'https://connect.facebook.net/log/fbevents_telemetry/'; function l(d) {
            const e = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 0; const f = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : !1; if (!f && !i) {
              return;
            } try {
              const k = new b(null); k.append('v', g.fbq && g.fbq.version ? g.fbq.version : 'unknown'); k.append('rs', h); k.append('e', d); k.append('p', e); c(k, { ignoreRequestLengthCheck: !0, url: j });
            } catch (b) {
              a.logError(b);
            }
          } function m(a) {
            l('FBMQ_FORWARDED', a, !0);
          }k.exports = { logMobileNativeForwarding: m };
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsTrackEventEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); let b = f.getFbeventsModules('SignalsFBEventsTyped'); const c = b.Typed; b.coerce; b = c.objectWithFields({ pixelID: c.allowNull(c.string()), eventName: c.string(), customData: c.allowNull(c.object()), eventData: c.allowNull(c.object()), eventId: c.allowNull(c.string()) }); a = new a(c.tuple([b])); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsTriggerSgwPixelTrackCommandConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); a.coerce; a = a.Typed; a = a.objectWithFields({ sgwPixelId: a.allowNull(a.string()), sgwHostUrl: a.allowNull(a.string()) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsTyped', () => {
      return (function (h, i, l, m) {
        const n = { exports: {} }; n.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsUtils'); a.filter; a.map; const b = a.reduce; a = f.getFbeventsModules('SignalsFBEventsUtils'); const c = a.isSafeInteger; const d = (function (a) {
            function b() {
              let a; const c = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : ''; w(this, b); a = g(this, b, [c]); a.name = 'FBEventsCoercionError'; return a;
            }j(b, a); return y(b);
          }(k(Error))); function e(a) {
            return Object.values(a);
          } function h() {
            return function (a) {
              if (typeof a !== 'boolean') {
                throw new d();
              } return a;
            };
          } function i() {
            return function (a) {
              if (typeof a !== 'number') {
                throw new d();
              } return a;
            };
          } function l() {
            return function (a) {
              if (typeof a !== 'string') {
                throw new d();
              } return a;
            };
          } function m() {
            return function (a) {
              if (typeof a !== 'string' && typeof a !== 'number') {
                throw new d();
              } return a;
            };
          } function o() {
            return function (a) {
              if (J(a) !== 'object' || Array.isArray(a) || a == null) {
                throw new d();
              } return a;
            };
          } function p() {
            return function (a) {
              if (J(a) !== 'object' && typeof a !== 'string' || Array.isArray(a) || a == null) {
                throw new d();
              } return a;
            };
          } function q() {
            return function (a) {
              if (typeof a !== 'function' || a == null) {
                throw new d();
              } return a;
            };
          } function r() {
            return function (a) {
              if (a == null || !Array.isArray(a)) {
                throw new d();
              } return a;
            };
          } function s(a) {
            return function (b) {
              if (e(a).includes(b)) {
                return b;
              } throw new d();
            };
          } function t(a) {
            return function (b) {
              return C(b, K.array()).map(a);
            };
          } function u(a) {
            return function (d) {
              const c = C(d, K.object()); return b(Object.keys(c), (b, d) => {
                return v(v({}, b), {}, z({}, d, a(c[d])));
              }, {});
            };
          } function x(a) {
            return function (b) {
              return b == null ? null : a(b);
            };
          } function A(a) {
            return function (d) {
              const c = C(d, K.object()); d = b(Object.keys(a), (b, d) => {
                if (b == null) {
                  return null;
                } let e = a[d]; const f = c[d]; e = e(f); return v(v({}, b), {}, z({}, d, e));
              }, {}); return d;
            };
          } function B(a, b) {
            try {
              return b(a);
            } catch (a) {
              if (a.name === 'FBEventsCoercionError') {
                return null;
              } throw a;
            }
          } function C(a, b) {
            return b(a);
          } function D(a) {
            return function (b) {
              b = C(b, K.string()); if (a.test(b)) {
                return b;
              } throw new d();
            };
          } function E(a) {
            if (!a) {
              throw new d();
            }
          } function F(a) {
            return function (b) {
              b = C(b, r()); E(b.length === a.length); return b.map((b, c) => {
                return C(b, a[c]);
              });
            };
          } function G(a) {
            const b = a.def; const c = a.validators; return function (a) {
              const e = C(a, b); c.forEach((a) => {
                if (!a(e)) {
                  throw new d();
                }
              }); return e;
            };
          } const H = /^[1-9]\d{0,25}$/; function I() {
            return G({ def(a) {
              const b = B(a, K.number()); if (b != null) {
                K.assert(c(b)); return ''.concat(b);
              } return C(a, K.string());
            }, validators: [function (a) {
              return H.test(a);
            }] });
          } var K = { allowNull: x, array: r, arrayOf: t, assert: E, boolean: h, enumeration: s, fbid: I, mapOf: u, matches: D, number: i, object: o, objectOrString: p, objectWithFields: A, string: l, stringOrNumber: m, tuple: F, withValidation: G, func: q }; n.exports = { Typed: K, coerce: B, enforce: C, FBEventsCoercionError: d };
        })(); return n.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsTypeVersioning', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          let a = f.getFbeventsModules('SignalsFBEventsTyped'); a.coerce; const b = a.enforce; const c = a.FBEventsCoercionError; function d(a) {
            return function (d) {
              for (let e = 0; e < a.length; e++) {
                const f = a[e]; try {
                  return b(d, f);
                } catch (a) {
                  if (a.name === 'FBEventsCoercionError') {
                    continue;
                  } throw a;
                }
              } throw new c();
            };
          } function e(a, c) {
            return function (d) {
              return c(b(d, a));
            };
          }a = { waterfall: d, upgrade: e }; k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsUnwantedDataTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); const b = a.Typed; a.coerce; a = b.objectWithFields({ blacklisted_keys: b.allowNull(b.mapOf(b.mapOf(b.arrayOf(b.string())))), sensitive_keys: b.allowNull(b.mapOf(b.mapOf(b.arrayOf(b.string())))) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsUnwantedEventNamesConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); a = a.Typed; a = a.objectWithFields({ unwantedEventNames: a.allowNull(a.mapOf(a.allowNull(a.number()))) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsUnwantedEventsConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); a = a.Typed; a = a.objectWithFields({ restrictedEventNames: a.allowNull(a.mapOf(a.allowNull(a.number()))) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsUnwantedParamsConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); a = a.Typed; a = a.objectWithFields({ unwantedParams: a.allowNull(a.arrayOf(a.string())) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsURLMetadataConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); a.coerce; a = a.Typed; a = a.objectWithFields({ contentIDRegex: a.arrayOf(a.objectWithFields({ regex: a.string(), regex_type: a.enumeration({ reversedpathregex: 'REVERSED_PATH_REGEX', queryparamregex: 'QUERY_PARAM_REGEX', pathregex: 'PATH_REGEX' }), domain: a.string() })) }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsUtils', () => {
      return (function (f, g, h, i) {
        const j = { exports: {} }; j.exports; (function () {
          'use strict'; const a = Object.prototype.toString; const b = !('addEventListener' in g); function c(a, b) {
            return b != null && a instanceof b;
          } function d(b) {
            return Array.isArray ? Array.isArray(b) : a.call(b) === '[object Array]';
          } function e(a) {
            return typeof a === 'number' || typeof a === 'string' && /^\d+$/.test(a);
          } function f(a) {
            return a != null && J(a) === 'object' && d(a) === !1;
          } function h(a) {
            return f(a) === !0 && Object.prototype.toString.call(a) === '[object Object]';
          } function i(a) {
            if (h(a) === !1) {
              return !1;
            } a = a.constructor; if (typeof a !== 'function') {
              return !1;
            } a = a.prototype; if (h(a) === !1) {
              return !1;
            } return Object.prototype.hasOwnProperty.call(a, 'isPrototypeOf') === !1 ? !1 : !0;
          } const k = Number.isInteger || function (a) {
            return typeof a === 'number' && isFinite(a) && Math.floor(a) === a;
          }; function l(a) {
            return k(a) && a >= 0 && a <= Number.MAX_SAFE_INTEGER;
          } function m(a, c, d) {
            const e = b ? `on${c}` : c; c = b ? a.attachEvent : a.addEventListener; const f = b ? a.detachEvent : a.removeEventListener; const g = function () {
              f && f.call(a, e, g, !1), d();
            }; c && c.call(a, e, g, !1);
          } const n = Object.prototype.hasOwnProperty; const o = !{ toString: null }.propertyIsEnumerable('toString'); const p = ['toString', 'toLocaleString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'constructor']; const q = p.length; function r(a) {
            if (J(a) !== 'object' && (typeof a !== 'function' || a === null)) {
              throw new TypeError('Object.keys called on non-object');
            } const b = []; for (var c in a) {
              n.call(a, c) && b.push(c);
            } if (o) {
              for (c = 0; c < q; c++) {
                n.call(a, p[c]) && b.push(p[c]);
              }
            } return b;
          } function s(a, b) {
            if (a == null) {
              throw new TypeError(' array is null or not defined');
            } a = Object(a); const c = a.length >>> 0; if (typeof b !== 'function') {
              throw new TypeError(`${b} is not a function`);
            } const d = new Array(c); let e = 0; while (e < c) {
              var f; e in a && (f = a[e], f = b(f, e, a), d[e] = f); e++;
            } return d;
          } function t(a, b, c, d) {
            if (a == null) {
              throw new TypeError(' array is null or not defined');
            } if (typeof b !== 'function') {
              throw new TypeError(`${b} is not a function`);
            } const e = Object(a); const f = e.length >>> 0; let g = 0; if (c != null || d === !0) {
              d = c;
            } else {
              while (g < f && !(g in e)) {
                g++;
              } if (g >= f) {
                throw new TypeError('Reduce of empty array with no initial value');
              } d = e[g++];
            } while (g < f) {
              g in e && (d = b(d, e[g], g, a)), g++;
            } return d;
          } function u(a) {
            if (typeof a !== 'function') {
              throw new TypeError();
            } const b = Object(this); const c = b.length >>> 0; const d = arguments.length >= 2 ? arguments[1] : void 0; for (let e = 0; e < c; e++) {
              if (e in b && a.call(d, b[e], e, b)) {
                return !0;
              }
            } return !1;
          } function v(a) {
            return r(a).length === 0;
          } function x(a) {
            if (this === void 0 || this === null) {
              throw new TypeError();
            } const b = Object(this); const c = b.length >>> 0; if (typeof a !== 'function') {
              throw new TypeError();
            } const d = []; const e = arguments.length >= 2 ? arguments[1] : void 0; for (let f = 0; f < c; f++) {
              if (f in b) {
                const g = b[f]; a.call(e, g, f, b) && d.push(g);
              }
            } return d;
          } function z(a, b) {
            try {
              return b(a);
            } catch (a) {
              if (a instanceof TypeError) {
                if (A.test(a)) {
                  return null;
                } else if (B.test(a)) {
                  return void 0;
                }
              } throw a;
            }
          } var A = /^null | null$|^[^(]* null /i; var B = /^undefined | undefined$|^[^(]* undefined /i; z.default = z; let C = (function () {
            function a(b) {
              w(this, a), this.items = b || [];
            } return y(a, [{ key: 'has', value(a) {
              return u.call(this.items, (b) => {
                return b === a;
              });
            } }, { key: 'add', value(a) {
              this.items.push(a);
            } }]);
          }()); function D(a) {
            return a;
          } function E(a, b) {
            return a == null || b == null ? !1 : a.includes(b);
          } function F(a, b) {
            return a == null || b == null ? !1 : a.indexOf(b) === 0;
          } function G(a) {
            return a.filter((b, c) => {
              return a.indexOf(b) === c;
            });
          }C = { FBSet: C, castTo: D, each(a, b) {
            s.call(this, a, b);
          }, filter(a, b) {
            return x.call(a, b);
          }, idx: z, isArray: d, isEmptyObject: v, isInstanceOf: c, isInteger: k, isNumber: e, isObject: f, isPlainObject: i, isSafeInteger: l, keys: r, listenOnce: m, map: s, reduce: t, some(a, b) {
            return u.call(a, b);
          }, stringIncludes: E, stringStartsWith: F, removeDuplicates: G }; j.exports = C;
        })(); return j.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsValidateCustomParametersEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); let b = f.getFbeventsModules('SignalsFBEventsTyped'); const c = b.coerce; const d = b.Typed; const e = f.getFbeventsModules('SignalsFBEventsPixelTypedef'); b = f.getFbeventsModules('SignalsFBEventsCoercePrimitives'); b.coerceString; function g() {
            for (var a = arguments.length, b = new Array(a), f = 0; f < a; f++) {
              b[f] = arguments[f];
            } return c(b, d.tuple([e, d.object(), d.string()]));
          }b = new a(g); k.exports = b;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsValidateGetClickIDFromBrowserProperties', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); function b(a) {
            return a != null && typeof a === 'string' && a !== '' ? a : null;
          }a = new a(b); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsValidateUrlParametersEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); let b = f.getFbeventsModules('SignalsFBEventsTyped'); const c = b.coerce; const d = b.Typed; const e = f.getFbeventsModules('SignalsFBEventsPixelTypedef'); b = f.getFbeventsModules('SignalsFBEventsCoercePrimitives'); b.coerceString; f.getFbeventsModules('SignalsParamList'); function g() {
            for (var a = arguments.length, b = new Array(a), f = 0; f < a; f++) {
              b[f] = arguments[f];
            } return c(b, d.tuple([e, d.mapOf(d.string()), d.string(), d.object()]));
          }b = new a(g); k.exports = b;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsValidationUtils', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsUtils'); const b = a.stringStartsWith; const c = /^[a-f0-9]{64}$/i; const d = /^\s+|\s+$/g; const e = /\s+/g; const g = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\s]+/g; const h = /[^a-z0-9]+/gi; const i = /^1\(?\d{3}\)?\d{7}$/; const j = /^47\d{8}$/; const l = /^\d{1,4}\(?\d{2,3}\)?\d{4,}$/; function m(a) {
            return typeof a === 'string' ? a.replace(d, '') : '';
          } function n(a) {
            const b = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 'whitespace_only'; let c = ''; if (typeof a === 'string') {
              switch (b) {
                case 'whitespace_only':c = a.replace(e, ''); break; case 'whitespace_and_punctuation':c = a.replace(g, ''); break; case 'all_non_latin_alpha_numeric':c = a.replace(h, ''); break;
              }
            } return c;
          } function o(a) {
            return typeof a === 'string' && c.test(a);
          } function p(a) {
            a = String(a).replace(/[\-\s]+/g, '').replace(/^\+?0{0,2}/, ''); if (b(a, '0')) {
              return !1;
            } if (b(a, '1')) {
              return i.test(a);
            } return b(a, '47') ? j.test(a) : l.test(a);
          }k.exports = { isInternationalPhoneNumber: p, looksLikeHashed: o, strip: n, trim: m };
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsWebchatConfigTypedef', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); a = a.Typed; a = a.objectWithFields({ automaticEventNamesEnabled: a.arrayOf(a.string()), automaticEventsEnabled: a.boolean(), pixelDataToWebchatEnabled: a.boolean() }); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsWebChatEvent', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsBaseEvent'); let b = f.getFbeventsModules('SignalsFBEventsTyped'); const c = b.Typed; b.coerce; b = c.objectWithFields({ pixelID: c.allowNull(c.string()), eventName: c.string(), customData: c.allowNull(c.object()), eventData: c.allowNull(c.object()), unsafeCustomParams: c.allowNull(c.object()) }); a = new a(c.tuple([b])); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsParamList', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsCensor'); const b = a.censoredIneligibleKeysWithUD; const c = f.getFbeventsModules('SignalsFBEventsGuardrail'); const d = 'deep'; const e = 'shallow'; const g = ['eid']; function h(a) {
            return JSON === void 0 || JSON === null || !JSON.stringify ? Object.prototype.toString.call(a) : JSON.stringify(a);
          } function i(a) {
            if (a === null || a === void 0) {
              return !0;
            } a = J(a); return a === 'number' || a === 'boolean' || a === 'string';
          }a = (function () {
            function a(b) {
              w(this, a), z(this, '_params', new Map()), this._piiTranslator = b;
            } return y(a, [{ key: 'containsKey', value(a) {
              return this._params.has(a);
            } }, { key: 'get', value(a) {
              a = this._params.get(a); return a == null || a.length === 0 ? null : a[a.length - 1];
            } }, { key: 'getAll', value(a) {
              a = this._params.get(a); return a || null;
            } }, { key: 'getAllParams', value() {
              const a = []; const b = G(this._params.entries()); let c; try {
                for (b.s(); !(c = b.n()).done;) {
                  c = q(c.value, 2); const d = c[0]; c = c[1]; c = G(c); var e; try {
                    for (c.s(); !(e = c.n()).done;) {
                      e = e.value; a.push({ name: d, value: e });
                    }
                  } catch (a) {
                    c.e(a);
                  } finally {
                    c.f();
                  }
                }
              } catch (a) {
                b.e(a);
              } finally {
                b.f();
              } return a;
            } }, { key: 'replaceEntry', value(a, b) {
              this._removeKey(a), this.append(a, b);
            } }, { key: 'replaceObjectEntry', value(a, b) {
              this._removeObjectKey(a, b), this.append(a, b);
            } }, { key: 'addRange', value(a) {
              this.addParams(a.getAllParams());
            } }, { key: 'addParams', value(a) {
              for (let b = 0; b < a.length; b++) {
                const c = a[b]; this._append({ name: c.name, value: c.value }, e, !1);
              } return this;
            } }, { key: 'append', value(a, b) {
              const c = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : !1; this._append({ name: encodeURIComponent(a), value: b }, d, c); return this;
            } }, { key: 'appendHash', value(a) {
              const b = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : !1; for (const c in a) {
                Object.prototype.hasOwnProperty.call(a, c) && this._append({ name: encodeURIComponent(c), value: a[c] }, d, b);
              } return this;
            } }, { key: '_removeKey', value(a) {
              this._params.delete(a);
            } }, { key: '_removeObjectKey', value(a, b) {
              for (const c in b) {
                if (Object.prototype.hasOwnProperty.call(b, c)) {
                  const d = ''.concat(a, '[').concat(encodeURIComponent(c), ']'); this._removeKey(d);
                }
              }
            } }, { key: '_append', value(a, b, c) {
              const e = a.name; a = a.value; if (a != null) {
                for (let f = 0; f < g.length; f++) {
                  const j = g[f]; j === e && this._removeKey(e);
                }
              }i(a) ? this._appendPrimitive(e, a, c) : b === d ? this._appendObject(e, a, c) : this._appendPrimitive(e, h(a), c);
            } }, { key: '_translateValue', value(a, d, e) {
              if (typeof d === 'boolean') {
                return d ? 'true' : 'false';
              } if (!e) {
                return ''.concat(d);
              } if (!this._piiTranslator) {
                throw new Error();
              } e = this._piiTranslator(a, ''.concat(d)); if (e == null) {
                return null;
              } b.includes(a) && c.eval('send_normalized_ud_format') && this._appendPrimitive(`nc${a}`, e.censoredFormat, !1); return e.finalValue;
            } }, { key: '_appendPrimitive', value(a, b, c) {
              if (b != null) {
                b = this._translateValue(a, b, c); if (b != null) {
                  c = this._params.get(a); c != null ? (c.push(b), this._params.set(a, c)) : this._params.set(a, [b]);
                }
              }
            } }, { key: '_appendObject', value(a, b, c) {
              let d = null; for (const f in b) {
                if (Object.prototype.hasOwnProperty.call(b, f)) {
                  const g = ''.concat(a, '[').concat(encodeURIComponent(f), ']'); try {
                    this._append({ name: g, value: b[f] }, e, c);
                  } catch (a) {
                    d == null && (d = a);
                  }
                }
              } if (d != null) {
                throw d;
              }
            } }, { key: 'each', value(a) {
              const b = G(this._params.entries()); let c; try {
                for (b.s(); !(c = b.n()).done;) {
                  c = q(c.value, 2); const d = c[0]; c = c[1]; c = G(c); var e; try {
                    for (c.s(); !(e = c.n()).done;) {
                      e = e.value; a(d, e);
                    }
                  } catch (a) {
                    c.e(a);
                  } finally {
                    c.f();
                  }
                }
              } catch (a) {
                b.e(a);
              } finally {
                b.f();
              }
            } }, { key: 'getEventId', value() {
              var a = ['eid', 'eid[]', encodeURIComponent('eid[]')]; for (var b = 0, a = a; b < a.length; b++) {
                let c = a[b]; c = this.get(c); if (c != null && c.length > 0) {
                  return c;
                }
              } return null;
            } }, { key: 'toQueryString', value() {
              const a = []; this.each((b, c) => {
                a.push(''.concat(b, '=').concat(encodeURIComponent(c)));
              }); return a.join('&');
            } }, { key: 'toFormData', value() {
              const a = this; const b = new FormData(); const d = c.eval('fix_fbevent_uri_error'); this.each((c, e) => {
                if (d) {
                  try {
                    b.append(decodeURIComponent(c), e);
                  } catch (d) {
                    b.append(c, e), a._appendPrimitive('ie[g]', '1', !1);
                  }
                } else {
                  b.append(decodeURIComponent(c), e);
                }
              }); return b;
            } }, { key: 'toObject', value() {
              const a = {}; this.each((b, c) => {
                a[b] = c;
              }); return a;
            } }], [{ key: 'fromHash', value(b, c) {
              return new a(c).appendHash(b);
            } }]);
          }()); k.exports = a;
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsPixelCookieUtils', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsPixelCookie'); const b = f.getFbeventsModules('signalsFBEventsGetIsChrome'); let c = f.getFbeventsModules('SignalsFBEventsLogging'); const d = c.logWarning; const e = 90 * 24 * 60 * 60 * 1e3; c = '_fbc'; const i = 'fbc'; const j = 'fbcs'; const l = '_fbp'; const m = 'fbp'; const n = 'fbclid'; const o = [{ prefix: '', query: 'fbclid', ebp_path: 'clickID' }]; const p = { params: o }; const q = !1; function r(a) {
            return new Date(Date.now() + Math.round(a)).toUTCString();
          } function s(a) {
            const b = []; try {
              const c = h.cookie.split(';'); a = '^\\s*'.concat(a, '=\\s*(.*?)\\s*$'); a = new RegExp(a); for (let e = 0; e < c.length; e++) {
                const f = c[e].match(a); f && b.push(f[1]);
              } return b && Object.prototype.hasOwnProperty.call(b, 0) && typeof b[0] === 'string' ? b[0] : '';
            } catch (a) {
              d(`Fail to read from cookie: ${a.message}`); return '';
            }
          } function t(b) {
            b = s(b); return typeof b !== 'string' || b === '' ? null : a.unpack(b);
          } function u(a, b) {
            return a.slice(a.length - 1 - b).join('.');
          } function v(a, c, f) {
            const g = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : e; try {
              const i = encodeURIComponent(c); h.cookie = `${''.concat(a, '=').concat(i, ';') + 'expires='.concat(r(g), ';') + 'domain=.'.concat(f, ';') + ''.concat(b() ? 'SameSite=Lax;' : '')}path=/`;
            } catch (a) {
              d(`Fail to write cookie: ${a.message}`);
            }
          } function w(a, b) {
            let c = g.location.hostname; c = c.split('.'); if (b.subdomainIndex == null) {
              throw new Error('Subdomain index not set on cookie.');
            } c = u(c, b.subdomainIndex); v(a, b.pack(), c, e); return b;
          } function x(b, c) {
            const d = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : e; const f = g.location.hostname; const h = f.split('.'); const i = new a(c); for (let j = 0; j < h.length; j++) {
              const k = u(h, j); i.subdomainIndex = j; v(b, i.pack(), k, d); const l = s(b); if (l != null && l != '' && a.unpack(l) != null) {
                return i;
              }
            } return i;
          }k.exports = { readPackedCookie: t, writeNewCookie: x, writeExistingCookie: w, CLICK_ID_PARAMETER: n, CLICKTHROUGH_COOKIE_NAME: c, CLICKTHROUGH_COOKIE_PARAM: i, DOMAIN_SCOPED_BROWSER_ID_COOKIE_NAME: l, DOMAIN_SCOPED_BROWSER_ID_COOKIE_PARAM: m, DEFAULT_FBC_PARAMS: o, DEFAULT_FBC_PARAM_CONFIG: p, DEFAULT_ENABLE_FBC_PARAM_SPLIT: q, MULTI_CLICKTHROUGH_COOKIE_PARAM: j, NINETY_DAYS_IN_MS: e };
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsPixelPIIConstants', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsUtils'); let b = a.keys; a = a.map; const c = { ct: 'ct', city: 'ct', dob: 'db', dobd: 'dobd', dobm: 'dobm', doby: 'doby', email: 'em', fn: 'fn', f_name: 'fn', gen: 'ge', ln: 'ln', l_name: 'ln', phone: 'ph', st: 'st', state: 'st', zip: 'zp', zip_code: 'zp', pn: 'ph', primaryPhone: 'ph', user_email: 'em', eMailAddress: 'em', email_sha256: 'em', email_paypal: 'em', consent_global_email_nl: 'em', consent_global_email_drip: 'em', consent_fide_email_nl: 'em', consent_fide_email_drip: 'em', bd: 'db', birthday: 'db', dOB: 'db', external_id: 'external_id' }; const d = { em: ['email', 'email_address', 'emailaddress', 'user_email', 'consent_global_email_nl', 'consent_global_email_drip', 'consent_fide_email_nl', 'consent_fide_email_drip', 'email_sha256', 'email_paypal'], ph: ['primaryphone', 'primary_phone', 'pn', 'phone', 'phone_number', 'tel', 'mobile'], ln: ['lastname', 'last_name', 'surname', 'lastnameeng'], fn: ['f_name', 'firstname', 'first_name', 'firstnameeng', 'name', 'profile_name', 'account_name', 'fbq_custom_name'], ge: ['gender', 'gen', '$gender'], db: ['dob', 'bd', 'birthday', 'd0b'], ct: ['city', '$city'], st: ['state', '$state'], zp: ['zipcode', 'zip_code', 'zip', 'postcode', 'post_code'] }; const e = { CITY: ['city'], DATE: ['date', 'dt', 'day', 'dobd'], DOB: ['birth', 'bday', 'bdate', 'bmonth', 'byear', 'dob'], FEMALE: ['female', 'girl', 'woman'], FIRST_NAME: ['firstname', 'fn', 'fname', 'givenname', 'forename'], GENDER_FIELDS: ['gender', 'gen', 'sex'], GENDER_VALUES: ['male', 'boy', 'man', 'female', 'girl', 'woman'], LAST_NAME: ['lastname', 'ln', 'lname', 'surname', 'sname', 'familyname'], MALE: ['male', 'boy', 'man'], MONTH: ['month', 'mo', 'mnth', 'dobm'], NAME: ['name', 'fullname'], PHONE_NUMBER: ['phone', 'mobile', 'contact'], RESTRICTED: ['ssn', 'unique', 'cc', 'card', 'cvv', 'cvc', 'cvn', 'creditcard', 'billing', 'security', 'social', 'pass'], STATE: ['state', 'province'], USERNAME: ['username'], YEAR: ['year', 'yr', 'doby'], ZIP_CODE: ['zip', 'zcode', 'pincode', 'pcode', 'postalcode', 'postcode'] }; let g = { alabama: 'al', alaska: 'ak', arizona: 'az', arkansas: 'ar', california: 'ca', colorado: 'co', connecticut: 'ct', delaware: 'de', florida: 'fl', georgia: 'ga', hawaii: 'hi', idaho: 'id', illinois: 'il', indiana: 'in', iowa: 'ia', kansas: 'ks', kentucky: 'ky', louisiana: 'la', maine: 'me', maryland: 'md', massachusetts: 'ma', michigan: 'mi', minnesota: 'mn', mississippi: 'ms', missouri: 'mo', montana: 'mt', nebraska: 'ne', nevada: 'nv', newhampshire: 'nh', newjersey: 'nj', newmexico: 'nm', newyork: 'ny', northcarolina: 'nc', northdakota: 'nd', ohio: 'oh', oklahoma: 'ok', oregon: 'or', pennsylvania: 'pa', rhodeisland: 'ri', southcarolina: 'sc', southdakota: 'sd', tennessee: 'tn', texas: 'tx', utah: 'ut', vermont: 'vt', virginia: 'va', washington: 'wa', westvirginia: 'wv', wisconsin: 'wi', wyoming: 'wy' }; let h = { ontario: 'on', quebec: 'qc', britishcolumbia: 'bc', alberta: 'ab', saskatchewan: 'sk', manitoba: 'mb', novascotia: 'ns', newbrunswick: 'nb', princeedwardisland: 'pe', newfoundlandandlabrador: 'nl', yukon: 'yt', northwestterritories: 'nt', nunavut: 'nu' }; h = v(v({}, h), g); g = { unitedstates: 'us', usa: 'us', ind: 'in', afghanistan: 'af', alandislands: 'ax', albania: 'al', algeria: 'dz', americansamoa: 'as', andorra: 'ad', angola: 'ao', anguilla: 'ai', antarctica: 'aq', antiguaandbarbuda: 'ag', argentina: 'ar', armenia: 'am', aruba: 'aw', australia: 'au', austria: 'at', azerbaijan: 'az', bahamas: 'bs', bahrain: 'bh', bangladesh: 'bd', barbados: 'bb', belarus: 'by', belgium: 'be', belize: 'bz', benin: 'bj', bermuda: 'bm', bhutan: 'bt', boliviaplurinationalstateof: 'bo', bolivia: 'bo', bonairesinteustatinsandsaba: 'bq', bosniaandherzegovina: 'ba', botswana: 'bw', bouvetisland: 'bv', brazil: 'br', britishindianoceanterritory: 'io', bruneidarussalam: 'bn', brunei: 'bn', bulgaria: 'bg', burkinafaso: 'bf', burundi: 'bi', cambodia: 'kh', cameroon: 'cm', canada: 'ca', capeverde: 'cv', caymanislands: 'ky', centralafricanrepublic: 'cf', chad: 'td', chile: 'cl', china: 'cn', christmasisland: 'cx', cocoskeelingislands: 'cc', colombia: 'co', comoros: 'km', congo: 'cg', congothedemocraticrepublicofthe: 'cd', democraticrepublicofthecongo: 'cd', cookislands: 'ck', costarica: 'cr', cotedivoire: 'ci', ivorycoast: 'ci', croatia: 'hr', cuba: 'cu', curacao: 'cw', cyprus: 'cy', czechrepublic: 'cz', denmark: 'dk', djibouti: 'dj', dominica: 'dm', dominicanrepublic: 'do', ecuador: 'ec', egypt: 'eg', elsalvador: 'sv', equatorialguinea: 'gq', eritrea: 'er', estonia: 'ee', ethiopia: 'et', falklandislandsmalvinas: 'fk', faroeislands: 'fo', fiji: 'fj', finland: 'fi', france: 'fr', frenchguiana: 'gf', frenchpolynesia: 'pf', frenchsouthernterritories: 'tf', gabon: 'ga', gambia: 'gm', georgia: 'ge', germany: 'de', ghana: 'gh', gibraltar: 'gi', greece: 'gr', greenland: 'gl', grenada: 'gd', guadeloupe: 'gp', guam: 'gu', guatemala: 'gt', guernsey: 'gg', guinea: 'gn', guineabissau: 'gw', guyana: 'gy', haiti: 'ht', heardislandandmcdonaldislands: 'hm', holyseevaticancitystate: 'va', vatican: 'va', honduras: 'hn', hongkong: 'hk', hungary: 'hu', iceland: 'is', india: 'in', indonesia: 'id', iranislamicrepublicof: 'ir', iran: 'ir', iraq: 'iq', ireland: 'ie', isleofman: 'im', israel: 'il', italy: 'it', jamaica: 'jm', japan: 'jp', jersey: 'je', jordan: 'jo', kazakhstan: 'kz', kenya: 'ke', kiribati: 'ki', koreademocraticpeoplesrepublicof: 'kp', northkorea: 'kp', korearepublicof: 'kr', southkorea: 'kr', kuwait: 'kw', kyrgyzstan: 'kg', laopeoplesdemocraticrepublic: 'la', laos: 'la', latvia: 'lv', lebanon: 'lb', lesotho: 'ls', liberia: 'lr', libya: 'ly', liechtenstein: 'li', lithuania: 'lt', luxembourg: 'lu', macao: 'mo', macedoniatheformeryugoslavrepublicof: 'mk', macedonia: 'mk', madagascar: 'mg', malawi: 'mw', malaysia: 'my', maldives: 'mv', mali: 'ml', malta: 'mt', marshallislands: 'mh', martinique: 'mq', mauritania: 'mr', mauritius: 'mu', mayotte: 'yt', mexico: 'mx', micronesiafederatedstatesof: 'fm', micronesia: 'fm', moldovarepublicof: 'md', moldova: 'md', monaco: 'mc', mongolia: 'mn', montenegro: 'me', montserrat: 'ms', morocco: 'ma', mozambique: 'mz', myanmar: 'mm', namibia: 'na', nauru: 'nr', nepal: 'np', netherlands: 'nl', newcaledonia: 'nc', newzealand: 'nz', nicaragua: 'ni', niger: 'ne', nigeria: 'ng', niue: 'nu', norfolkisland: 'nf', northernmarianaislands: 'mp', norway: 'no', oman: 'om', pakistan: 'pk', palau: 'pw', palestinestateof: 'ps', palestine: 'ps', panama: 'pa', papuanewguinea: 'pg', paraguay: 'py', peru: 'pe', philippines: 'ph', pitcairn: 'pn', poland: 'pl', portugal: 'pt', puertorico: 'pr', qatar: 'qa', reunion: 're', romania: 'ro', russianfederation: 'ru', russia: 'ru', rwanda: 'rw', saintbarthelemy: 'bl', sainthelenaascensionandtristandacunha: 'sh', saintkittsandnevis: 'kn', saintlucia: 'lc', saintmartinfrenchpart: 'mf', saintpierreandmiquelon: 'pm', saintvincentandthegrenadines: 'vc', samoa: 'ws', sanmarino: 'sm', saotomeandprincipe: 'st', saudiarabia: 'sa', senegal: 'sn', serbia: 'rs', seychelles: 'sc', sierraleone: 'sl', singapore: 'sg', sintmaartenductchpart: 'sx', slovakia: 'sk', slovenia: 'si', solomonislands: 'sb', somalia: 'so', southafrica: 'za', southgeorgiaandthesouthsandwichislands: 'gs', southsudan: 'ss', spain: 'es', srilanka: 'lk', sudan: 'sd', suriname: 'sr', svalbardandjanmayen: 'sj', eswatini: 'sz', swaziland: 'sz', sweden: 'se', switzerland: 'ch', syrianarabrepublic: 'sy', syria: 'sy', taiwanprovinceofchina: 'tw', taiwan: 'tw', tajikistan: 'tj', tanzaniaunitedrepublicof: 'tz', tanzania: 'tz', thailand: 'th', timorleste: 'tl', easttimor: 'tl', togo: 'tg', tokelau: 'tk', tonga: 'to', trinidadandtobago: 'tt', tunisia: 'tn', turkey: 'tr', turkmenistan: 'tm', turksandcaicosislands: 'tc', tuvalu: 'tv', uganda: 'ug', ukraine: 'ua', unitedarabemirates: 'ae', unitedkingdom: 'gb', unitedstatesofamerica: 'us', unitedstatesminoroutlyingislands: 'um', uruguay: 'uy', uzbekistan: 'uz', vanuatu: 'vu', venezuelabolivarianrepublicof: 've', venezuela: 've', vietnam: 'vn', virginislandsbritish: 'vg', virginislandsus: 'vi', wallisandfutuna: 'wf', westernsahara: 'eh', yemen: 'ye', zambia: 'zm', zimbabwe: 'zw' }; const i = /^\+?\d{1,4}[-.\s]?\(?\d{1,3}?\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}$/; const j = /^[\w!#$%&'*+/=?^`{|}~\-]+(:?\.[\w!#$%&'*+/=?^`{|}~\-]+)*@(?:[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?$/i; const l = /^\d{5}(?:[-\s]\d{4})?$/; const m = Object.freeze({ US: '^\\d{5}$' }); a = a(b(m), (a) => {
            return m[a];
          }); b = {}; b['^\\d{1,2}/\\d{1,2}/\\d{4}$'] = ['DD/MM/YYYY', 'MM/DD/YYYY']; b['^\\d{1,2}-\\d{1,2}-\\d{4}$'] = ['DD-MM-YYYY', 'MM-DD-YYYY']; b['^\\d{4}/\\d{1,2}/\\d{1,2}$'] = ['YYYY/MM/DD']; b['^\\d{4}-\\d{1,2}-\\d{1,2}$'] = ['YYYY-MM-DD']; b['^\\d{1,2}/\\d{1,2}/\\d{2}$'] = ['DD/MM/YY', 'MM/DD/YY']; b['^\\d{1,2}-\\d{1,2}-\\d{2}$'] = ['DD-MM-YY', 'MM-DD-YY']; b['^\\d{2}/\\d{1,2}/\\d{1,2}$'] = ['YY/MM/DD']; b['^\\d{2}-\\d{1,2}-\\d{1,2}$'] = ['YY-MM-DD']; const n = ['MM-DD-YYYY', 'MM/DD/YYYY', 'DD-MM-YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'YYYY/MM/DD', 'MM-DD-YY', 'MM/DD/YY', 'DD-MM-YY', 'DD/MM/YY', 'YY-MM-DD', 'YY/MM/DD']; k.exports = { COUNTRY_MAPPINGS: g, EMAIL_REGEX: j, PHONE_NUMBER_REGEX: i, POSSIBLE_FEATURE_FIELDS: e, PII_KEY_ALIAS_TO_SHORT_CODE: c, SIGNALS_FBEVENTS_DATE_FORMATS: n, VALID_DATE_REGEX_FORMATS: b, ZIP_REGEX_VALUES: a, ZIP_CODE_REGEX: l, STATE_MAPPINGS: h, PII_KEYS_TO_ALIASES_EXPANDED: d };
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsPixelPIIUtils', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsCensor'); const b = a.censorPII; const c = f.getFbeventsModules('SignalsFBEventsNormalizers'); const d = f.getFbeventsModules('SignalsFBEventsPixelPIISchema'); a = f.getFbeventsModules('SignalsFBEventsUtils'); const e = f.getFbeventsModules('SignalsFBEventsGuardrail'); const g = f.getFbeventsModules('normalizeSignalsFBEventsEmailType'); const h = f.getFbeventsModules('normalizeSignalsFBEventsPostalCodeType'); const i = f.getFbeventsModules('normalizeSignalsFBEventsPhoneNumberType'); let j = f.getFbeventsModules('normalizeSignalsFBEventsStringType'); const l = j.normalizeName; const m = j.normalizeCity; const n = j.normalizeState; j = f.getFbeventsModules('SignalsPixelPIIConstants'); const o = j.EMAIL_REGEX; const p = j.POSSIBLE_FEATURE_FIELDS; const q = j.PII_KEY_ALIAS_TO_SHORT_CODE; const r = j.ZIP_REGEX_VALUES; const s = j.ZIP_CODE_REGEX; const t = j.PHONE_NUMBER_REGEX; const u = a.some; const w = a.stringIncludes; function x(a) {
            const b = a.id; const c = a.keyword; const d = a.name; const e = a.placeholder; a = a.value; return c.length > 2 ? w(d, c) || w(b, c) || w(e, c) || w(a, c) : d === c || b === c || e === c || a === c;
          } function y(a) {
            const b = a.id; const c = a.keywords; const d = a.name; const e = a.placeholder; const f = a.value; return u(c, (a) => {
              return x({ id: b, keyword: a, name: d, placeholder: e, value: f });
            });
          } function z(a) {
            return a != null && typeof a === 'string' && o.test(a);
          } function A(a) {
            a = a; typeof a === 'number' && typeof a.toString === 'function' && (a = a.toString()); return a != null && typeof a === 'string' && a.length > 6 && t.test(a);
          } function B(a) {
            a = a; typeof a === 'number' && typeof a.toString === 'function' && (a = a.toString()); return a != null && typeof a === 'string' && s.test(a);
          } function C(a) {
            const b = a.value; let c = a.parentElement; a = a.previousElementSibling; let d = null; a instanceof HTMLInputElement ? d = a.value : a instanceof HTMLTextAreaElement && (d = a.value); if (d == null || typeof d !== 'string') {
              return null;
            } if (c == null) {
              return null;
            } a = c.innerText != null ? c.innerText : c.textContent; if (a == null || !a.includes('@')) {
              return null;
            } c = ''.concat(d, '@').concat(b); return !o.test(c) ? null : c;
          } function D(a, b) {
            const c = a.name; const d = a.id; const e = a.placeholder; a = a.value; return b === 'tel' && !(a.length <= 6 && p.ZIP_CODE.includes(d)) || y({ id: d, keywords: p.PHONE_NUMBER, name: c, placeholder: e });
          } function E(a) {
            const b = a.name; const c = a.id; a = a.placeholder; return y({ id: c, keywords: p.FIRST_NAME, name: b, placeholder: a });
          } function F(a) {
            const b = a.name; const c = a.id; a = a.placeholder; return y({ id: c, keywords: p.LAST_NAME, name: b, placeholder: a });
          } function G(a) {
            const b = a.name; const c = a.id; a = a.placeholder; return y({ id: c, keywords: p.NAME, name: b, placeholder: a }) && !y({ id: c, keywords: p.USERNAME, name: b, placeholder: a });
          } function H(a) {
            const b = a.name; const c = a.id; a = a.placeholder; return y({ id: c, keywords: p.CITY, name: b, placeholder: a });
          } function I(a) {
            const b = a.name; const c = a.id; a = a.placeholder; return y({ id: c, keywords: p.STATE, name: b, placeholder: a });
          } function J(a, b, c) {
            const d = a.name; const e = a.id; const f = a.placeholder; a = a.value; if ((b === 'checkbox' || b === 'radio') && c === !0) {
              return y({ id: e, keywords: p.GENDER_VALUES, name: d, placeholder: f, value: a });
            } else if (b === 'text') {
              return y({ id: e, keywords: p.GENDER_FIELDS, name: d, placeholder: f });
            } return !1;
          } function K(a, b) {
            const c = a.name; a = a.id; return b !== '' && u(r, (a) => {
              a = b.match(String(a)); return a != null && a[0] === b;
            }) || y({ id: a, keywords: p.ZIP_CODE, name: c });
          } function L(a) {
            const b = a.name; a = a.id; return y({ id: a, keywords: p.RESTRICTED, name: b });
          } function M(a) {
            return a.trim().toLowerCase().replace(/[_-]/g, '');
          } function N(a) {
            return a.trim().toLowerCase();
          } function O(a) {
            if (u(p.MALE, (b) => {
              return b === a;
            })) {
              return 'm';
            } else if (u(p.FEMALE, (b) => {
              return b === a;
            })) {
              return 'f';
            } return '';
          } function P(a) {
            return q[a] !== void 0 ? q[a] : a;
          } function Q(a, b) {
            const e = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : !1; const f = P(a); let g = d[f]; (g == null || g.length === 0) && (g = d.default); const h = c[g.type]; if (h == null) {
              return null;
            } const i = h(b, g.typeParams, e); return i != null && i !== '' ? i : null;
          } function aa(a, c) {
            const d = c.value; const f = c instanceof HTMLInputElement && c.checked === !0; let j = a.name; let k = a.id; const o = a.inputType; a = a.placeholder; j = { id: M(j), name: M(k), placeholder: a != null && M(a) || '', value: N(d) }; if (L(j) || o === 'password' || d === '' || d == null) {
              return null;
            } else if (z(j.value)) {
              return { normalized: { em: g(j.value) }, alternateNormalized: { em: g(j.value) }, rawCensored: e.eval('send_censored_em') ? { em: b(d) } : {} };
            } else if (C(c) != null) {
              return { normalized: { em: g(C(c)) }, alternateNormalized: { em: g(C(c)) }, rawCensored: e.eval('send_censored_em') ? { em: b(d) } : {} };
            } else if (E(j)) {
              return { normalized: { fn: l(j.value) }, alternateNormalized: { fn: l(j.value) }, rawCensored: e.eval('send_censored_ph') ? { fn: b(d) } : {} };
            } else if (F(j)) {
              return { normalized: { ln: l(j.value) }, alternateNormalized: { ln: l(j.value) }, rawCensored: e.eval('send_censored_ph') ? { ln: b(d) } : {} };
            } else if (D(j, o)) {
              return { normalized: { ph: i(j.value) }, alternateNormalized: { ph: i(j.value, null, !0) }, rawCensored: e.eval('send_censored_ph') ? { ph: b(j.value) } : {} };
            } else if (G(j)) {
              k = d.split(' '); a = k[0]; k.shift(); c = k.join(' '); k = j.value.split(' '); const p = { fn: l(k[0]) }; k.shift(); k = { ln: l(k.join(' ')) }; return { normalized: v(v({}, p), k), alternateNormalized: v(v({}, p), k), rawCensored: e.eval('send_censored_ph') ? { fn: b(a), ln: b(c) } : {} };
            } else if (H(j)) {
              return { normalized: { ct: m(j.value) }, alternateNormalized: { ct: m(j.value) }, rawCensored: { ct: b(d) } };
            } else if (I(j)) {
              return { normalized: { st: n(j.value) }, alternateNormalized: { st: n(j.value, null, !0) }, rawCensored: e.eval('send_censored_ph') ? { st: b(d) } : {} };
            } else if (o != null && J(j, o, f)) {
              return { normalized: { ge: O(j.value) }, alternateNormalized: { ge: O(j.value) }, rawCensored: e.eval('send_censored_ph') ? { ge: b(d) } : {} };
            } else if (K(j, d)) {
              return { normalized: { zp: h(j.value) }, alternateNormalized: { zp: h(j.value) }, rawCensored: e.eval('send_censored_ph') ? { zp: b(d) } : {} };
            } return null;
          }k.exports = { extractPIIFields: aa, getNormalizedPIIKey: P, getNormalizedPIIValue: Q, isEmail: z, getGenderCharacter: O, isPhoneNumber: A, isZipCode: B };
        })(); return k.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEvents.plugins.commonincludes', () => {
      return (function (g, h, i, j) {
        const k = { exports: {} }; k.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsPlugin'); k.exports = new a((a, b) => {});
        })(); return k.exports;
      }(a, b, c, d));
    }); e.exports = f.getFbeventsModules('SignalsFBEvents.plugins.commonincludes'); f.registerPlugin && f.registerPlugin('fbevents.plugins.commonincludes', e.exports);
    f.ensureModuleRegistered('fbevents.plugins.commonincludes', () => {
      return e.exports;
    });
  })();
})(window, document, location, history);
(function (a, b, c, d) {
  const e = { exports: {} }; e.exports; (function () {
    const f = a.fbq; f.execStart = a.performance && a.performance.now && a.performance.now(); if (!(function () {
      const b = a.postMessage || function () {}; if (!f) {
        b({ action: 'FB_LOG', logType: 'Facebook Pixel Error', logMessage: 'Pixel code is not installed correctly on this page' }, '*'); 'error' in console && console.error('Facebook Pixel Error: Pixel code is not installed correctly on this page'); return !1;
      } return !0;
    }())) {
      return;
    } function g(a) {
      return g = typeof Symbol == 'function' && typeof (typeof Symbol === 'function' ? Symbol.iterator : '@@iterator') == 'symbol'
        ? function (a) {
          return typeof a;
        }
        : function (a) {
          return a && typeof Symbol == 'function' && a.constructor === Symbol && a !== (typeof Symbol === 'function' ? Symbol.prototype : '@@prototype') ? 'symbol' : typeof a;
        }, g(a);
    } function h(a, b) {
      for (let c = 0; c < b.length; c++) {
        const d = b[c]; d.enumerable = d.enumerable || !1, d.configurable = !0, 'value' in d && (d.writable = !0), Object.defineProperty(a, j(d.key), d);
      }
    } function i(a, b, c) {
      return b && h(a.prototype, b), c && h(a, c), Object.defineProperty(a, 'prototype', { writable: !1 }), a;
    } function j(a) {
      a = k(a, 'string'); return g(a) == 'symbol' ? a : `${a}`;
    } function k(a, b) {
      if (g(a) != 'object' || !a) {
        return a;
      } let c = a[typeof Symbol === 'function' ? Symbol.toPrimitive : '@@toPrimitive']; if (void 0 !== c) {
        c = c.call(a, b || 'default'); if (g(c) != 'object') {
          return c;
        } throw new TypeError('@@toPrimitive must return a primitive value.');
      } return (b === 'string' ? String : Number)(a);
    } function l(a, b) {
      if (!(a instanceof b)) {
        throw new TypeError('Cannot call a class as a function');
      }
    } function m(a, b, c) {
      return b = q(b), n(a, p() ? Reflect.construct(b, c || [], q(a).constructor) : b.apply(a, c));
    } function n(a, b) {
      if (b && (g(b) == 'object' || typeof b == 'function')) {
        return b;
      } if (void 0 !== b) {
        throw new TypeError('Derived constructors may only return object or undefined');
      } return o(a);
    } function o(a) {
      if (void 0 === a) {
        throw new ReferenceError('this hasn\'t been initialised - super() hasn\'t been called');
      } return a;
    } function p() {
      try {
        var a = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], () => {}));
      } catch (a) {} return (p = function () {
        return !!a;
      })();
    } function q(a) {
      return q = Object.setPrototypeOf
        ? Object.getPrototypeOf.bind()
        : function (a) {
          return a.__proto__ || Object.getPrototypeOf(a);
        }, q(a);
    } function r(a, b) {
      if (typeof b != 'function' && b !== null) {
        throw new TypeError('Super expression must either be null or a function');
      } a.prototype = Object.create(b && b.prototype, { constructor: { value: a, writable: !0, configurable: !0 } }), Object.defineProperty(a, 'prototype', { writable: !1 }), b && s(a, b);
    } function s(a, b) {
      return s = Object.setPrototypeOf
        ? Object.setPrototypeOf.bind()
        : function (a, b) {
          return a.__proto__ = b, a;
        }, s(a, b);
    } function t(a, b) {
      return y(a) || x(a, b) || v(a, b) || u();
    } function u() {
      throw new TypeError('Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.');
    } function v(a, b) {
      if (a) {
        if (typeof a == 'string') {
          return w(a, b);
        } let c = {}.toString.call(a).slice(8, -1); return c === 'Object' && a.constructor && (c = a.constructor.name), c === 'Map' || c === 'Set' ? Array.from(a) : c === 'Arguments' || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(c) ? w(a, b) : void 0;
      }
    } function w(a, b) {
      (b == null || b > a.length) && (b = a.length); for (var c = 0, d = Array(b); c < b; c++) {
        d[c] = a[c];
      } return d;
    } function x(a, b) {
      let c = a == null ? null : typeof Symbol != 'undefined' && a[typeof Symbol === 'function' ? Symbol.iterator : '@@iterator'] || a['@@iterator']; if (c != null) {
        let d; let e; const f = []; let g = !0; let h = !1; try {
          if (a = (c = c.call(a)).next, b === 0) {
            if (Object(c) !== c) {
              return;
            } g = !1;
          } else {
            for (;!(g = (d = a.call(c)).done) && (f.push(d.value), f.length !== b); g = !0) {
              ;
            }
          }
        } catch (a) {
          h = !0, e = a;
        } finally {
          try {
            if (!g && c.return != null && (d = c.return(), Object(d) !== d)) {
              return;
            }
          } finally {
            if (h) {
              throw e;
            }
          }
        } return f;
      }
    } function y(a) {
      if (Array.isArray(a)) {
        return a;
      }
    }f.__fbeventsModules || (f.__fbeventsModules = {}, f.__fbeventsResolvedModules = {}, f.getFbeventsModules = function (a) {
      f.__fbeventsResolvedModules[a] || (f.__fbeventsResolvedModules[a] = f.__fbeventsModules[a]()); return f.__fbeventsResolvedModules[a];
    }, f.fbIsModuleLoaded = function (a) {
      return !!f.__fbeventsModules[a];
    }, f.ensureModuleRegistered = function (b, a) {
      f.fbIsModuleLoaded(b) || (f.__fbeventsModules[b] = a);
    });
    f.ensureModuleRegistered('sha256_with_dependencies_new', () => {
      return (function (f, g, h, i) {
        const j = { exports: {} }; j.exports; (function () {
          'use strict'; function a(a) {
            let b = ''; let c; let d; for (let e = 0; e < a.length; e++) {
              c = a.charCodeAt(e), d = e + 1 < a.length ? a.charCodeAt(e + 1) : 0, c >= 55296 && c <= 56319 && d >= 56320 && d <= 57343 && (c = 65536 + ((c & 1023) << 10) + (d & 1023), e++), c <= 127 ? b += String.fromCharCode(c) : c <= 2047 ? b += String.fromCharCode(192 | c >>> 6 & 31, 128 | c & 63) : c <= 65535 ? b += String.fromCharCode(224 | c >>> 12 & 15, 128 | c >>> 6 & 63, 128 | c & 63) : c <= 2097151 && (b += String.fromCharCode(240 | c >>> 18 & 7, 128 | c >>> 12 & 63, 128 | c >>> 6 & 63, 128 | c & 63));
            } return b;
          } function b(a, b) {
            return b >>> a | b << 32 - a;
          } function c(a, b, c) {
            return a & b ^ ~a & c;
          } function d(a, b, c) {
            return a & b ^ a & c ^ b & c;
          } function e(a) {
            return b(2, a) ^ b(13, a) ^ b(22, a);
          } function f(a) {
            return b(6, a) ^ b(11, a) ^ b(25, a);
          } function g(a) {
            return b(7, a) ^ b(18, a) ^ a >>> 3;
          } function h(a) {
            return b(17, a) ^ b(19, a) ^ a >>> 10;
          } function i(a, b) {
            return a[b & 15] += h(a[b + 14 & 15]) + a[b + 9 & 15] + g(a[b + 1 & 15]);
          } const k = [1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580, 3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986, 2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037, 2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344, 430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779, 1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298]; const l = Array.from({ length: 8 }); const m = Array.from({ length: 2 }); const n = Array.from({ length: 64 }); const o = Array.from({ length: 16 }); const p = '0123456789abcdef'; function q(a, b) {
            const c = (a & 65535) + (b & 65535); a = (a >> 16) + (b >> 16) + (c >> 16); return a << 16 | c & 65535;
          } function r() {
            m[0] = m[1] = 0, l[0] = 1779033703, l[1] = 3144134277, l[2] = 1013904242, l[3] = 2773480762, l[4] = 1359893119, l[5] = 2600822924, l[6] = 528734635, l[7] = 1541459225;
          } function s() {
            let a, b, g, h, j, m, p, r, s, t; g = l[0]; h = l[1]; j = l[2]; m = l[3]; p = l[4]; r = l[5]; s = l[6]; t = l[7]; for (var u = 0; u < 16; u++) {
              o[u] = n[(u << 2) + 3] | n[(u << 2) + 2] << 8 | n[(u << 2) + 1] << 16 | n[u << 2] << 24;
            } for (u = 0; u < 64; u++) {
              a = t + f(p) + c(p, r, s) + k[u], u < 16 ? a += o[u] : a += i(o, u), b = e(g) + d(g, h, j), t = s, s = r, r = p, p = q(m, a), m = j, j = h, h = g, g = q(a, b);
            }l[0] += g; l[1] += h; l[2] += j; l[3] += m; l[4] += p; l[5] += r; l[6] += s; l[7] += t;
          } function t(a, b) {
            let c; let d; let e = 0; d = m[0] >> 3 & 63; const f = b & 63; (m[0] += b << 3) < b << 3 && m[1]++; m[1] += b >> 29; for (c = 0; c + 63 < b; c += 64) {
              for (var g = d; g < 64; g++) {
                n[g] = a.charCodeAt(e++);
              }s(); d = 0;
            } for (g = 0; g < f; g++) {
              n[g] = a.charCodeAt(e++);
            }
          } function u() {
            let a = m[0] >> 3 & 63; n[a++] = 128; if (a <= 56) {
              for (var b = a; b < 56; b++) {
                n[b] = 0;
              }
            } else {
              for (b = a; b < 64; b++) {
                n[b] = 0;
              }s(); for (a = 0; a < 56; a++) {
                n[a] = 0;
              }
            }n[56] = m[1] >>> 24 & 255; n[57] = m[1] >>> 16 & 255; n[58] = m[1] >>> 8 & 255; n[59] = m[1] & 255; n[60] = m[0] >>> 24 & 255; n[61] = m[0] >>> 16 & 255; n[62] = m[0] >>> 8 & 255; n[63] = m[0] & 255; s();
          } function v() {
            let a = ''; for (let b = 0; b < 8; b++) {
              for (let c = 28; c >= 0; c -= 4) {
                a += p.charAt(l[b] >>> c & 15);
              }
            } return a;
          } function w(a) {
            let b = 0; for (let c = 0; c < 8; c++) {
              for (let d = 28; d >= 0; d -= 4) {
                a[b++] = p.charCodeAt(l[c] >>> d & 15);
              }
            }
          } function x(a, b) {
            r(); t(a, a.length); u(); if (b) {
              w(b);
            } else {
              return v();
            }
          } function y(b) {
            const c = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : !0; const d = arguments.length > 2 ? arguments[2] : void 0; if (b === null || b === void 0) {
              return null;
            } let e = b; c && (e = a(b)); return x(e, d);
          }j.exports = y;
        })(); return j.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEvents.plugins.identity', () => {
      return (function (g, h, j, k) {
        const n = { exports: {} }; n.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsCensor'); const b = a.censorPII; a = f.getFbeventsModules('SignalsFBEventsLogging'); const c = a.logUserError; a = f.getFbeventsModules('SignalsFBEventsPlugin'); let d = f.getFbeventsModules('SignalsFBEventsUtils'); d = d.FBSet; let e = f.getFbeventsModules('SignalsPixelPIIUtils'); const g = e.getNormalizedPIIKey; const h = e.getNormalizedPIIValue; const j = f.getFbeventsModules('sha256_with_dependencies_new'); const k = /^[A-F0-9]{64}$|^[A-F0-9]{32}$/i; const o = /^[\w!#$%&'*+/=?^`{|}~\-]+(:?\.[\w!#$%&'*+/=?^`{|}~\-]+)*@(?:[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?$/i; e = /^\s+|\s+$/g; Object.prototype.hasOwnProperty; const p = new d(['uid']); function q(a) {
            return !!a && o.test(a);
          } function s(a, b, d) {
            const e = g(a); if (b == null || b === '') {
              return null;
            } d = h(e, b, d); if (e === 'em' && !q(d)) {
              c({ key_type: 'email address', key_val: a, type: 'PII_INVALID_TYPE' }); throw new Error();
            } return d != null && d != '' ? d : b;
          } function u(a, d) {
            if (d == null) {
              return null;
            } let e = /\[(.*)\]/.exec(a); if (e == null) {
              throw new Error();
            } let f = !1; a.length > 0 && a[0] === 'a' && (f = !0); e = t(e, 2); e = e[1]; if (p.has(e)) {
              if (q(d)) {
                c({ key: a, type: 'PII_UNHASHED_PII' }); throw new Error();
              } return { finalValue: d };
            } if (k.test(d)) {
              a = d.toLowerCase(); return { finalValue: a, censoredFormat: b(a) };
            }a = s(e, d, f); return a != null && a != '' ? { finalValue: j(a), censoredFormat: b(a) } : null;
          }e = (function (a) {
            function b(a) {
              let c; l(this, b); c = m(this, b, [function (b) {
                b.piiTranslator = a;
              }]); c.piiTranslator = a; return c;
            }r(b, a); return i(b);
          }(a)); d = new e(u); n.exports = d;
        })(); return n.exports;
      }(a, b, c, d));
    }); e.exports = f.getFbeventsModules('SignalsFBEvents.plugins.identity'); f.registerPlugin && f.registerPlugin('fbevents.plugins.identity', e.exports);
    f.ensureModuleRegistered('fbevents.plugins.identity', () => {
      return e.exports;
    });
  })();
})(window, document, location, history);
(function (a, b, c, d) {
  const e = { exports: {} }; e.exports; (function () {
    const f = a.fbq; f.execStart = a.performance && a.performance.now && a.performance.now(); if (!(function () {
      const b = a.postMessage || function () {}; if (!f) {
        b({ action: 'FB_LOG', logType: 'Facebook Pixel Error', logMessage: 'Pixel code is not installed correctly on this page' }, '*'); 'error' in console && console.error('Facebook Pixel Error: Pixel code is not installed correctly on this page'); return !1;
      } return !0;
    }())) {
      return;
    } f.__fbeventsModules || (f.__fbeventsModules = {}, f.__fbeventsResolvedModules = {}, f.getFbeventsModules = function (a) {
      f.__fbeventsResolvedModules[a] || (f.__fbeventsResolvedModules[a] = f.__fbeventsModules[a]()); return f.__fbeventsResolvedModules[a];
    }, f.fbIsModuleLoaded = function (a) {
      return !!f.__fbeventsModules[a];
    }, f.ensureModuleRegistered = function (b, a) {
      f.fbIsModuleLoaded(b) || (f.__fbeventsModules[b] = a);
    });
    f.ensureModuleRegistered('signalsFBEventsGetIsAndroid', () => {
      return (function (f, b, c, d) {
        const e = { exports: {} }; e.exports; (function () {
          'use strict'; let a = f.navigator; a = a.userAgent; const b = a.includes('Android'); function c() {
            return b;
          }e.exports = c;
        })(); return e.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('signalsFBEventsGetIsAndroidIAW', () => {
      return (function (a, b, c, d) {
        const e = { exports: {} }; e.exports; (function () {
          'use strict'; const b = f.getFbeventsModules('signalsFBEventsGetIsAndroid'); let c = a.navigator; c = c.userAgent; const d = c.includes('FB_IAB'); const g = c.includes('Instagram'); let h = 0; c = c.match(/(FBAV|Instagram)[/\s](\d+)/); if (c != null) {
            c = c[0].match(/(\d+)/); c != null && (h = Number.parseInt(c[0], 10));
          } function i(a, c) {
            const e = b() && (d || g); if (!e) {
              return !1;
            } if (d && a != null) {
              return a <= h;
            } return g && c != null ? c <= h : e;
          }e.exports = i;
        })(); return e.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEvents.plugins.privacysandbox', () => {
      return (function (a, b, c, d) {
        const e = { exports: {} }; e.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('signalsFBEventsGetIsChrome'); const c = f.getFbeventsModules('signalsFBEventsGetIsAndroidIAW'); f.getFbeventsModules('SignalsParamList'); let d = f.getFbeventsModules('SignalsFBEventsNetworkConfig'); const g = d.GPS_ENDPOINT; const h = f.getFbeventsModules('signalsFBEventsSendGET'); const i = f.getFbeventsModules('SignalsFBEventsFiredEvent'); d = f.getFbeventsModules('SignalsFBEventsPlugin'); e.exports = new d((d, e) => {
            if (!a() && !c()) {
              return;
            } if (b.featurePolicy == null || !b.featurePolicy.allowsFeature('attribution-reporting')) {
              return;
            } i.listen((a, b) => {
              a = b.get('id'); if (a == null) {
                return;
              } h(b, { ignoreRequestLengthCheck: !0, attributionReporting: !0, url: g });
            });
          });
        })(); return e.exports;
      }(a, b, c, d));
    }); e.exports = f.getFbeventsModules('SignalsFBEvents.plugins.privacysandbox'); f.registerPlugin && f.registerPlugin('fbevents.plugins.privacysandbox', e.exports);
    f.ensureModuleRegistered('fbevents.plugins.privacysandbox', () => {
      return e.exports;
    });
  })();
})(window, document, location, history);
(function (a, b, c, d) {
  const e = { exports: {} }; e.exports; (function () {
    const f = a.fbq; f.execStart = a.performance && a.performance.now && a.performance.now(); if (!(function () {
      const b = a.postMessage || function () {}; if (!f) {
        b({ action: 'FB_LOG', logType: 'Facebook Pixel Error', logMessage: 'Pixel code is not installed correctly on this page' }, '*'); 'error' in console && console.error('Facebook Pixel Error: Pixel code is not installed correctly on this page'); return !1;
      } return !0;
    }())) {
      return;
    } f.__fbeventsModules || (f.__fbeventsModules = {}, f.__fbeventsResolvedModules = {}, f.getFbeventsModules = function (a) {
      f.__fbeventsResolvedModules[a] || (f.__fbeventsResolvedModules[a] = f.__fbeventsModules[a]()); return f.__fbeventsResolvedModules[a];
    }, f.fbIsModuleLoaded = function (a) {
      return !!f.__fbeventsModules[a];
    }, f.ensureModuleRegistered = function (b, a) {
      f.fbIsModuleLoaded(b) || (f.__fbeventsModules[b] = a);
    });
    f.ensureModuleRegistered('signalsFBEventsGetIwlUrl', () => {
      return (function (a, b, c, d) {
        const e = { exports: {} }; e.exports; (function () {
          'use strict'; const b = f.getFbeventsModules('signalsFBEventsGetTier'); const c = d(); function d() {
            try {
              if (a.trustedTypes && a.trustedTypes.createPolicy) {
                const b = a.trustedTypes; return b.createPolicy('facebook.com/signals/iwl', { createScriptURL(b) {
                  let c = typeof a.URL === 'function' ? a.URL : a.webkitURL; c = new c(b); c = c.hostname.endsWith('.facebook.com') && c.pathname == '/signals/iwl.js'; if (!c) {
                    throw new Error('Disallowed script URL');
                  } return b;
                } });
              }
            } catch (a) {} return null;
          }e.exports = function (a, d, e, f) {
            d = b(d); d = d == null ? 'www.facebook.com' : 'www.'.concat(d, '.facebook.com'); d = 'https://'.concat(d, '/signals/iwl.js?pixel_id=').concat(a, '&access_token=').concat(e); f === !0 && (d += '&from_extension=true'); if (c != null) {
              return c.createScriptURL(d);
            } else {
              return d;
            }
          };
        })(); return e.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('signalsFBEventsGetTier', () => {
      return (function (f, b, c, d) {
        const e = { exports: {} }; e.exports; (function () {
          'use strict'; const a = /^https:\/\/www\.([A-Za-z0-9.]+)\.facebook\.com\/tr\/?$/; const b = ['https://www.facebook.com/tr', 'https://www.facebook.com/tr/']; e.exports = function (c) {
            if (b.includes(c)) {
              return null;
            } const d = a.exec(c); if (d == null) {
              throw new Error('Malformed tier: '.concat(c));
            } return d[1];
          };
        })(); return e.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEvents.plugins.iwlbootstrapper', () => {
      return (function (a, b, c, d) {
        const e = { exports: {} }; e.exports; (function () {
          'use strict'; const c = f.getFbeventsModules('SignalsFBEventsIWLBootStrapEvent'); const d = f.getFbeventsModules('SignalsFBEventsLogging'); const g = f.getFbeventsModules('SignalsFBEventsNetworkConfig'); const h = f.getFbeventsModules('SignalsFBEventsPlugin'); const i = f.getFbeventsModules('signalsFBEventsGetIwlUrl'); const j = f.getFbeventsModules('signalsFBEventsGetTier'); const k = d.logUserError; const l = /^https:\/\/.*\.facebook\.com$/i; const m = 'FACEBOOK_IWL_CONFIG_STORAGE_KEY'; const n = 'signals-browser-extension'; let o = null; e.exports = new h((d, e) => {
            try {
              o = a.sessionStorage
                ? a.sessionStorage
                : { getItem(a) {
                    return null;
                  }, removeItem(a) {}, setItem(a, b) {} };
            } catch (a) {
              return;
            } let h = !1; function p(c, d, e, f, k) {
              const l = b.createElement('script'); l.async = !0; l.onload = function () {
                if (!a.FacebookIWL || !a.FacebookIWL.init) {
                  return;
                } const b = j(g.ENDPOINT); b != null && a.FacebookIWL.set && a.FacebookIWL.set('tier', b); e();
              }; a.FacebookIWLSessionEnd = function () {
                o.removeItem(m), f ? (h = !1, f()) : a.close();
              }; l.src = i(c, g.ENDPOINT, d, k); b.body && b.body.appendChild(l);
            } const q = function (a) {
              return !!(e && e.pixelsByID && Object.prototype.hasOwnProperty.call(e.pixelsByID, a));
            }; function r(b, c) {
              if (h) {
                return;
              } let d = o.getItem(m); if (!d) {
                return;
              } d = JSON.parse(d); const e = d.pixelID; const f = d.graphToken; const g = d.sessionStartTime; h = !0; p(e, f, () => {
                const b = q(e) ? e.toString() : null; a.FacebookIWL.init(b, f, g);
              }, b, c);
            } function s(b, c, d) {
              if (h) {
                return;
              } p(b, c, () => {
                return a.FacebookIWL.showConfirmModal(b);
              }, void 0, d);
            } function t(a, b, c, d, e) {
              o.setItem(m, JSON.stringify({ graphToken: a, pixelID: b, sessionStartTime: c })), r(d, e);
            }c.listen((b) => {
              const c = b.graphToken; b = b.pixelID; t(c, b); a.FacebookIWLSessionEnd = function () {
                return o.removeItem(m);
              };
            }); function d(a) {
              let b = a.data; const c = b.graphToken; let d = b.msg_type; const f = b.pixelID; const g = b.sessionStartTime; b = b.source; if (e && e.pixelsByID && e.pixelsByID[f] && e.pixelsByID[f].codeless === 'false') {
                k({ pixelID: f, type: 'SITE_CODELESS_OPT_OUT' }); return;
              } let h = l.test(a.origin) || b === n; if (o.getItem(m) || !h || !(a.data && (d === 'FACEBOOK_IWL_BOOTSTRAP' || d === 'FACEBOOK_IWL_CONFIRM_DOMAIN'))) {
                return;
              } if (!Object.prototype.hasOwnProperty.call(e.pixelsByID, f)) {
                a.source.postMessage('FACEBOOK_IWL_ERROR_PIXEL_DOES_NOT_MATCH', a.origin); return;
              } switch (d) {
                case 'FACEBOOK_IWL_BOOTSTRAP':a.source.postMessage('FACEBOOK_IWL_BOOTSTRAP_ACK', a.origin); h = b === n; d = h
                  ? function () {
                    return a.source.postMessage('FACEBOOK_IWL_SESSION_ENDED', a.origin);
                  }
                  : void 0; t(c, f, g, d, h); break; case 'FACEBOOK_IWL_CONFIRM_DOMAIN':a.source.postMessage('FACEBOOK_IWL_CONFIRM_DOMAIN_ACK', a.origin); s(f, c); break;
              }
            } if (o.getItem(m)) {
              r(); return;
            }a.addEventListener('message', d);
          });
        })(); return e.exports;
      }(a, b, c, d));
    }); e.exports = f.getFbeventsModules('SignalsFBEvents.plugins.iwlbootstrapper'); f.registerPlugin && f.registerPlugin('fbevents.plugins.iwlbootstrapper', e.exports);
    f.ensureModuleRegistered('fbevents.plugins.iwlbootstrapper', () => {
      return e.exports;
    });
  })();
})(window, document, location, history);
(function (a, b, c, d) {
  const e = { exports: {} }; e.exports; (function () {
    const f = a.fbq; f.execStart = a.performance && a.performance.now && a.performance.now(); if (!(function () {
      const b = a.postMessage || function () {}; if (!f) {
        b({ action: 'FB_LOG', logType: 'Facebook Pixel Error', logMessage: 'Pixel code is not installed correctly on this page' }, '*'); 'error' in console && console.error('Facebook Pixel Error: Pixel code is not installed correctly on this page'); return !1;
      } return !0;
    }())) {
      return;
    } f.__fbeventsModules || (f.__fbeventsModules = {}, f.__fbeventsResolvedModules = {}, f.getFbeventsModules = function (a) {
      f.__fbeventsResolvedModules[a] || (f.__fbeventsResolvedModules[a] = f.__fbeventsModules[a]()); return f.__fbeventsResolvedModules[a];
    }, f.fbIsModuleLoaded = function (a) {
      return !!f.__fbeventsModules[a];
    }, f.ensureModuleRegistered = function (b, a) {
      f.fbIsModuleLoaded(b) || (f.__fbeventsModules[b] = a);
    });
    f.ensureModuleRegistered('SignalsFBEventsOptTrackingOptions', () => {
      return (function (f, b, c, d) {
        const e = { exports: {} }; e.exports; (function () {
          'use strict'; e.exports = { AUTO_CONFIG_OPT_OUT: 1 << 0, AUTO_CONFIG: 1 << 1, CONFIG_LOADING: 1 << 2, SUPPORTS_DEFINE_PROPERTY: 1 << 3, SUPPORTS_SEND_BEACON: 1 << 4, HAS_INVALIDATED_PII: 1 << 5, SHOULD_PROXY: 1 << 6, IS_HEADLESS: 1 << 7, IS_SELENIUM: 1 << 8, HAS_DETECTION_FAILED: 1 << 9, HAS_CONFLICTING_PII: 1 << 10, HAS_AUTOMATCHED_PII: 1 << 11, FIRST_PARTY_COOKIES: 1 << 12, IS_SHADOW_TEST: 1 << 13 };
        })(); return e.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsProxyState', () => {
      return (function (f, b, c, d) {
        const e = { exports: {} }; e.exports; (function () {
          'use strict'; let a = !1; e.exports = { getShouldProxy() {
            return a;
          }, setShouldProxy(b) {
            a = b;
          } };
        })(); return e.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEvents.plugins.opttracking', () => {
      return (function (a, b, c, d) {
        const e = { exports: {} }; e.exports; (function () {
          'use strict'; let b = f.getFbeventsModules('SignalsFBEventsEvents'); const c = b.getCustomParameters; const d = b.piiAutomatched; const g = b.piiConflicting; const h = b.piiInvalidated; const i = f.getFbeventsModules('SignalsFBEventsOptTrackingOptions'); b = f.getFbeventsModules('SignalsFBEventsPlugin'); const j = f.getFbeventsModules('SignalsFBEventsProxyState'); let k = f.getFbeventsModules('SignalsFBEventsUtils'); const l = k.some; let m = !1; function n() {
            try {
              Object.defineProperty({}, 'test', {});
            } catch (a) {
              return !1;
            } return !0;
          } function o() {
            return !!(a.navigator && a.navigator.sendBeacon);
          } function p(a, b) {
            return a ? b : 0;
          } const q = ['_selenium', 'callSelenium', '_Selenium_IDE_Recorder']; const r = ['__webdriver_evaluate', '__selenium_evaluate', '__webdriver_script_function', '__webdriver_script_func', '__webdriver_script_fn', '__fxdriver_evaluate', '__driver_unwrapped', '__webdriver_unwrapped', '__driver_evaluate', '__selenium_unwrapped', '__fxdriver_unwrapped']; function s() {
            if (u(q)) {
              return !0;
            } let b = l(r, (b) => {
              return a.document[b] ? !0 : !1;
            }); if (b) {
              return !0;
            } b = a.document; for (var c in b) {
              if (c.match(/\$[a-z]dc_/) && b[c].cache_) {
                return !0;
              }
            } if (a.external && a.external.toString && a.external.toString().includes('Sequentum')) {
              return !0;
            } if (b.documentElement && b.documentElement.getAttribute) {
              c = l(['selenium', 'webdriver', 'driver'], (b) => {
                return a.document.documentElement.getAttribute(b) ? !0 : !1;
              }); if (c) {
                return !0;
              }
            } return !1;
          } function t() {
            if (u(['_phantom', '__nightmare', 'callPhantom'])) {
              return !0;
            } return /HeadlessChrome/.test(a.navigator.userAgent) ? !0 : !1;
          } function u(b) {
            b = l(b, (b) => {
              return a[b] ? !0 : !1;
            }); return b;
          } function v() {
            let a = 0; let b = 0; let c = 0; try {
              a = p(s(), i.IS_SELENIUM), b = p(t(), i.IS_HEADLESS);
            } catch (a) {
              c = i.HAS_DETECTION_FAILED;
            } return { hasDetectionFailed: c, isHeadless: b, isSelenium: a };
          }k = new b((a, b) => {
            if (m) {
              return;
            } const e = {}; h.listen((a) => {
              a != null && (e[typeof a === 'string' ? a : a.id] = !0);
            }); const k = {}; g.listen((a) => {
              a != null && (k[typeof a === 'string' ? a : a.id] = !0);
            }); const l = {}; d.listen((a) => {
              a != null && (l[typeof a === 'string' ? a : a.id] = !0);
            }); c.listen((c) => {
              let d = b.optIns; let f = p(c != null && d.isOptedOut(c.id, 'AutomaticSetup') && d.isOptedOut(c.id, 'InferredEvents') && d.isOptedOut(c.id, 'Microdata'), i.AUTO_CONFIG_OPT_OUT); const g = p(c != null && (d.isOptedIn(c.id, 'AutomaticSetup') || d.isOptedIn(c.id, 'InferredEvents') || d.isOptedIn(c.id, 'Microdata')), i.AUTO_CONFIG); const h = p(a.disableConfigLoading !== !0, i.CONFIG_LOADING); const m = p(n(), i.SUPPORTS_DEFINE_PROPERTY); const q = p(o(), i.SUPPORTS_SEND_BEACON); const r = p(c != null && k[c.id], i.HAS_CONFLICTING_PII); const s = p(c != null && e[c.id], i.HAS_INVALIDATED_PII); const t = p(c != null && l[c.id], i.HAS_AUTOMATCHED_PII); const u = p(j.getShouldProxy(), i.SHOULD_PROXY); const w = p(c != null && d.isOptedIn(c.id, 'FirstPartyCookies'), i.FIRST_PARTY_COOKIES); d = p(c != null && d.isOptedIn(c.id, 'ShadowTest'), i.IS_SHADOW_TEST); c = v(); f = f | g | h | m | q | s | u | c.isHeadless | c.isSelenium | c.hasDetectionFailed | r | t | w | d; return { o: f };
            }); m = !0;
          }); k.OPTIONS = i; e.exports = k;
        })(); return e.exports;
      }(a, b, c, d));
    }); e.exports = f.getFbeventsModules('SignalsFBEvents.plugins.opttracking'); f.registerPlugin && f.registerPlugin('fbevents.plugins.opttracking', e.exports);
    f.ensureModuleRegistered('fbevents.plugins.opttracking', () => {
      return e.exports;
    });
  })();
})(window, document, location, history);
(function (a, b, c, d) {
  const e = { exports: {} }; e.exports; (function () {
    const f = a.fbq; f.execStart = a.performance && a.performance.now && a.performance.now(); if (!(function () {
      const b = a.postMessage || function () {}; if (!f) {
        b({ action: 'FB_LOG', logType: 'Facebook Pixel Error', logMessage: 'Pixel code is not installed correctly on this page' }, '*'); 'error' in console && console.error('Facebook Pixel Error: Pixel code is not installed correctly on this page'); return !1;
      } return !0;
    }())) {
      return;
    } f.__fbeventsModules || (f.__fbeventsModules = {}, f.__fbeventsResolvedModules = {}, f.getFbeventsModules = function (a) {
      f.__fbeventsResolvedModules[a] || (f.__fbeventsResolvedModules[a] = f.__fbeventsModules[a]()); return f.__fbeventsResolvedModules[a];
    }, f.fbIsModuleLoaded = function (a) {
      return !!f.__fbeventsModules[a];
    }, f.ensureModuleRegistered = function (b, a) {
      f.fbIsModuleLoaded(b) || (f.__fbeventsModules[b] = a);
    });
    f.ensureModuleRegistered('SignalsFBEvents.plugins.unwanteddata', () => {
      return (function (a, b, c, d) {
        const e = { exports: {} }; e.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsEvents'); a.configLoaded; const b = a.validateCustomParameters; const c = a.validateUrlParameters; const d = f.getFbeventsModules('SignalsFBEventsConfigStore'); const g = f.getFbeventsModules('SignalsFBEventsLogging'); a = f.getFbeventsModules('SignalsFBEventsPlugin'); const h = f.getFbeventsModules('SignalsFBEventsUtils'); const i = f.getFbeventsModules('sha256_with_dependencies_new'); h.each; const j = h.map; let k = !1; f.getFbeventsModules('SignalsParamList'); e.exports = new a((a, e) => {
            b.listen((b, c, f) => {
              if (b == null) {
                return {};
              } a.performanceMark('fbevents:start:unwantedDataProcessing', b.id); let h = e.optIns.isOptedIn(b.id, 'UnwantedData'); if (!h) {
                return {};
              } h = e.optIns.isOptedIn(b.id, 'ProtectedDataMode'); let k = d.get(b.id, 'unwantedData'); if (k == null) {
                return {};
              } let l = !1; const m = []; const n = []; const o = {}; if (k.blacklisted_keys != null) {
                var p = k.blacklisted_keys[f]; if (p != null) {
                  p = p.cd; j(p, (a) => {
                    Object.prototype.hasOwnProperty.call(c, a) && (l = !0, m.push(a), delete c[a]);
                  });
                }
              } if (k.sensitive_keys != null) {
                p = k.sensitive_keys[f]; if (p != null) {
                  const q = p.cd; Object.keys(c).forEach((a) => {
                    j(q, (b) => {
                      i(a) === b && (l = !0, n.push(b), delete c[a]);
                    });
                  });
                }
              }o.unwantedParams = m; o.restrictedParams = n; if (l && !h) {
                k = m.length > 0; f = n.length > 0; if (k || f) {
                  a.performanceMark('fbevents:end:unwantedDataProcessing', b.id); g.logUserError({ type: 'UNWANTED_CUSTOM_DATA' }); p = {}; k && (p.up = m.join(',')); f && (p.rp = n.join(',')); return p;
                }
              }a.performanceMark('fbevents:end:unwantedDataProcessing', b.id); return {};
            }); function h(a, b, c, d, e) {
              const f = new URLSearchParams(b.search); const g = []; const h = []; b = {}; if (c.blacklisted_keys != null) {
                var l = c.blacklisted_keys[d]; if (l != null) {
                  l = l.url; j(l, (a) => {
                    f.has(a) && (k = !0, g.push(a), f.set(a, '_removed_'));
                  });
                }
              } if (c.sensitive_keys != null) {
                l = c.sensitive_keys[d]; if (l != null) {
                  const m = l.url; f.forEach((a, b) => {
                    j(m, (a) => {
                      i(b) === a && (k = !0, h.push(a), f.set(b, '_removed_'));
                    });
                  });
                }
              }b.unwantedParams = g; b.restrictedParams = h; if (k) {
                e || (g.length > 0 && a.append('up_url', g.join(',')), h.length > 0 && a.append('rp_url', h.join(','))); return f.toString();
              } return '';
            }c.listen((b, c, f, i) => {
              if (b == null) {
                return;
              } a.performanceMark('fbevents:start:validateUrlProcessing', b.id); let j = e.optIns.isOptedIn(b.id, 'UnwantedData'); if (!j) {
                return;
              } j = e.optIns.isOptedIn(b.id, 'ProtectedDataMode'); const l = d.get(b.id, 'unwantedData'); if (l == null) {
                return;
              } k = !1; if (Object.prototype.hasOwnProperty.call(c, 'dl') && c.dl.length > 0) {
                var m = new URL(c.dl); var n = h(i, m, l, f, j); k && n.length > 0 && (m.search = n, c.dl = m.toString());
              } if (Object.prototype.hasOwnProperty.call(c, 'rl') && c.rl.length > 0) {
                n = new URL(c.rl); m = h(i, n, l, f, j); k && m.length > 0 && (n.search = m, c.rl = n.toString());
              }k && g.logUserError({ type: 'UNWANTED_URL_DATA' }); a.performanceMark('fbevents:end:validateUrlProcessing', b.id);
            });
          });
        })(); return e.exports;
      }(a, b, c, d));
    }); e.exports = f.getFbeventsModules('SignalsFBEvents.plugins.unwanteddata'); f.registerPlugin && f.registerPlugin('fbevents.plugins.unwanteddata', e.exports);
    f.ensureModuleRegistered('fbevents.plugins.unwanteddata', () => {
      return e.exports;
    });
  })();
})(window, document, location, history);
(function (a, b, c, d) {
  const e = { exports: {} }; e.exports; (function () {
    const f = a.fbq; f.execStart = a.performance && a.performance.now && a.performance.now(); if (!(function () {
      const b = a.postMessage || function () {}; if (!f) {
        b({ action: 'FB_LOG', logType: 'Facebook Pixel Error', logMessage: 'Pixel code is not installed correctly on this page' }, '*'); 'error' in console && console.error('Facebook Pixel Error: Pixel code is not installed correctly on this page'); return !1;
      } return !0;
    }())) {
      return;
    } f.__fbeventsModules || (f.__fbeventsModules = {}, f.__fbeventsResolvedModules = {}, f.getFbeventsModules = function (a) {
      f.__fbeventsResolvedModules[a] || (f.__fbeventsResolvedModules[a] = f.__fbeventsModules[a]()); return f.__fbeventsResolvedModules[a];
    }, f.fbIsModuleLoaded = function (a) {
      return !!f.__fbeventsModules[a];
    }, f.ensureModuleRegistered = function (b, a) {
      f.fbIsModuleLoaded(b) || (f.__fbeventsModules[b] = a);
    });
    f.ensureModuleRegistered('SignalsFBEvents.plugins.eventvalidation', () => {
      return (function (a, b, c, d) {
        const e = { exports: {} }; e.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsPlugin'); const b = f.getFbeventsModules('SignalsFBEventsSendEventEvent'); let c = f.getFbeventsModules('SignalsFBEventsTyped'); const d = c.coerce; const g = c.Typed; c = f.getFbeventsModules('SignalsFBEventsLogging'); const h = c.logUserError; e.exports = new a((a, c) => {
            b.listen((a) => {
              let b = a.id; a = a.eventName; b = d(b, g.fbid()); if (b == null) {
                return !1;
              } let e = c.optIns.isOptedIn(b, 'EventValidation'); if (!e) {
                return !1;
              } e = c.pluginConfig.get(b, 'eventValidation'); if (e == null) {
                return !1;
              } b = e.unverifiedEventNames; e = e.restrictedEventNames; let f = !1; let i = !1; b && (f = b.includes(a), f && h({ type: 'UNVERIFIED_EVENT' })); e && (i = e.includes(a), i && h({ type: 'RESTRICTED_EVENT' })); return f || i;
            });
          });
        })(); return e.exports;
      }(a, b, c, d));
    }); e.exports = f.getFbeventsModules('SignalsFBEvents.plugins.eventvalidation'); f.registerPlugin && f.registerPlugin('fbevents.plugins.eventvalidation', e.exports);
    f.ensureModuleRegistered('fbevents.plugins.eventvalidation', () => {
      return e.exports;
    });
  })();
})(window, document, location, history);
(function (a, b, c, d) {
  const e = { exports: {} }; e.exports; (function () {
    const f = a.fbq; f.execStart = a.performance && a.performance.now && a.performance.now(); if (!(function () {
      const b = a.postMessage || function () {}; if (!f) {
        b({ action: 'FB_LOG', logType: 'Facebook Pixel Error', logMessage: 'Pixel code is not installed correctly on this page' }, '*'); 'error' in console && console.error('Facebook Pixel Error: Pixel code is not installed correctly on this page'); return !1;
      } return !0;
    }())) {
      return;
    } function g(a, b) {
      let c = typeof Symbol != 'undefined' && a[typeof Symbol === 'function' ? Symbol.iterator : '@@iterator'] || a['@@iterator']; if (!c) {
        if (Array.isArray(a) || (c = h(a)) || b && a && typeof a.length == 'number') {
          c && (a = c); let d = 0; b = function () {}; return { s: b, n() {
            return d >= a.length ? { done: !0 } : { done: !1, value: a[d++] };
          }, e(a) {
            throw a;
          }, f: b };
        } throw new TypeError('Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.');
      } let e; let f = !0; let g = !1; return { s() {
        c = c.call(a);
      }, n() {
        const a = c.next(); return f = a.done, a;
      }, e(a) {
        g = !0, e = a;
      }, f() {
        try {
          f || c.return == null || c.return();
        } finally {
          if (g) {
            throw e;
          }
        }
      } };
    } function h(a, b) {
      if (a) {
        if (typeof a == 'string') {
          return i(a, b);
        } let c = {}.toString.call(a).slice(8, -1); return c === 'Object' && a.constructor && (c = a.constructor.name), c === 'Map' || c === 'Set' ? Array.from(a) : c === 'Arguments' || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(c) ? i(a, b) : void 0;
      }
    } function i(a, b) {
      (b == null || b > a.length) && (b = a.length); for (var c = 0, d = Array(b); c < b; c++) {
        d[c] = a[c];
      } return d;
    }f.__fbeventsModules || (f.__fbeventsModules = {}, f.__fbeventsResolvedModules = {}, f.getFbeventsModules = function (a) {
      f.__fbeventsResolvedModules[a] || (f.__fbeventsResolvedModules[a] = f.__fbeventsModules[a]()); return f.__fbeventsResolvedModules[a];
    }, f.fbIsModuleLoaded = function (a) {
      return !!f.__fbeventsModules[a];
    }, f.ensureModuleRegistered = function (b, a) {
      f.fbIsModuleLoaded(b) || (f.__fbeventsModules[b] = a);
    });
    f.ensureModuleRegistered('SignalsFBEventsClientHintTypedef', () => {
      return (function (g, h, i, d) {
        const e = { exports: {} }; e.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsTyped'); a.coerce; a = a.Typed; const b = a.objectWithFields({ brands: a.array(), platform: a.allowNull(a.string()), getHighEntropyValues: a.func() }); a = a.objectWithFields({ model: a.allowNull(a.string()), platformVersion: a.allowNull(a.string()), fullVersionList: a.array() }); e.exports = { userAgentDataTypedef: b, highEntropyResultTypedef: a };
        })(); return e.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEventsGetIsAndroidChrome', () => {
      return (function (g, h, i, d) {
        const e = { exports: {} }; e.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('signalsFBEventsGetIsChrome'); function b(a) {
            return a === void 0
              ? !1
              : a.platform === 'Android' && a.brands.map((a) => {
                return a.brand;
              }).join(', ').includes('Chrome');
          } function c(a) {
            return a.includes('Chrome') && a.includes('Android');
          } function d(b) {
            b = b.includes('Android'); const c = a(); return b && c;
          }e.exports = { checkIsAndroidChromeWithClientHint: b, checkIsAndroidChromeWithUAString: c, checkIsAndroidChrome: d };
        })(); return e.exports;
      }(a, b, c, d));
    });
    f.ensureModuleRegistered('SignalsFBEvents.plugins.clienthint', () => {
      return (function (h, i, c, d) {
        const e = { exports: {} }; e.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsEvents'); a.fired; a = f.getFbeventsModules('SignalsFBEventsPlugin'); const b = f.getFbeventsModules('SignalsParamList'); let c = f.getFbeventsModules('SignalsFBEventsEvents'); c.configLoaded; f.getFbeventsModules('SignalsFBEventsSendEventEvent'); c = f.getFbeventsModules('SignalsFBEventsLogging'); c.logError; const d = c.logWarning; const i = c.logInfo; c = f.getFbeventsModules('SignalsFBEventsTyped'); const j = c.coerce; c.Typed; c = f.getFbeventsModules('SignalsFBEventsClientHintTypedef'); const k = c.userAgentDataTypedef; const l = c.highEntropyResultTypedef; c = f.getFbeventsModules('SignalsFBEventsGetIsAndroidChrome'); const m = c.checkIsAndroidChrome; const n = 'chmd'; const o = 'chpv'; const p = 'chfv'; const q = [n, o, p]; const r = 'clientHint'; const s = 'pixel'; const t = 'clienthint'; function u(a) {
            a = j(a, l); if (a == null) {
              i(new Error('[ClientHint Error] getHighEntropyValues returned null from Android Chrome source'), s, t); return new Map();
            } const b = new Map(); b.set(n, String(a.model)); b.set(o, String(a.platformVersion)); let c; a = g(a.fullVersionList); let d; try {
              for (a.s(); !(d = a.n()).done;) {
                d = d.value, d.brand.includes('Chrome') && (c = d.version);
              }
            } catch (b) {
              a.e(b);
            } finally {
              a.f();
            }b.set(p, String(c)); return b;
          } function v(a, b) {
            const c = g(q); let d; try {
              for (c.s(); !(d = c.n()).done;) {
                d = d.value; a.get(d) == null && a.append(d, b.get(d));
              }
            } catch (a) {
              c.e(a);
            } finally {
              c.f();
            }
          } function w(a, c, d) {
            d = u(a); a = c.customParams || new b(); v(a, d); c.customParams = a;
          }e.exports = new a((a, b) => {
            a = j(h.navigator.userAgentData, k); if (a == null) {
              h.navigator.userAgentData != null && d(new Error('[ClientHint Error] UserAgentData coerce error')); return;
            } else if (!m(h.navigator.userAgent)) {
              return;
            } a = h.navigator.userAgentData.getHighEntropyValues(['model', 'platformVersion', 'fullVersionList']).then((a) => {
              const c = b.asyncParamFetchers.get(r); c != null && c.result == null && (c.result = a, b.asyncParamFetchers.set(r, c)); return a;
            }).catch((a) => {
              a.message = `[ClientHint Error] Fetch error${a.message}`, d(a);
            }); b.asyncParamFetchers.set(r, { request: a, callback: w }); b.asyncParamPromisesAllSettled = !1;
          });
        })(); return e.exports;
      }(a, b, c, d));
    }); e.exports = f.getFbeventsModules('SignalsFBEvents.plugins.clienthint'); f.registerPlugin && f.registerPlugin('fbevents.plugins.clienthint', e.exports);
    f.ensureModuleRegistered('fbevents.plugins.clienthint', () => {
      return e.exports;
    });
  })();
})(window, document, location, history);
(function (a, b, c, d) {
  const e = { exports: {} }; e.exports; (function () {
    const f = a.fbq; f.execStart = a.performance && a.performance.now && a.performance.now(); if (!(function () {
      const b = a.postMessage || function () {}; if (!f) {
        b({ action: 'FB_LOG', logType: 'Facebook Pixel Error', logMessage: 'Pixel code is not installed correctly on this page' }, '*'); 'error' in console && console.error('Facebook Pixel Error: Pixel code is not installed correctly on this page'); return !1;
      } return !0;
    }())) {
      return;
    } f.__fbeventsModules || (f.__fbeventsModules = {}, f.__fbeventsResolvedModules = {}, f.getFbeventsModules = function (a) {
      f.__fbeventsResolvedModules[a] || (f.__fbeventsResolvedModules[a] = f.__fbeventsModules[a]()); return f.__fbeventsResolvedModules[a];
    }, f.fbIsModuleLoaded = function (a) {
      return !!f.__fbeventsModules[a];
    }, f.ensureModuleRegistered = function (b, a) {
      f.fbIsModuleLoaded(b) || (f.__fbeventsModules[b] = a);
    });
    f.ensureModuleRegistered('SignalsFBEvents.plugins.unwantedparams', () => {
      return (function (a, b, c, d) {
        const e = { exports: {} }; e.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsEvents'); const b = a.validateCustomParameters; const c = f.getFbeventsModules('SignalsFBEventsConfigStore'); a = f.getFbeventsModules('SignalsFBEventsPlugin'); f.getFbeventsModules('SignalsParamList'); const d = f.getFbeventsModules('SignalsFBEventsUtils'); const g = d.each; e.exports = new a((a, d) => {
            b.listen((b, e, f) => {
              if (b == null) {
                return {};
              } a.performanceMark('fbevents:start:unwantedParamsProcessing', b.id); f = d.optIns.isOptedIn(b.id, 'UnwantedParams'); if (!f) {
                return {};
              } f = c.get(b.id, 'unwantedParams'); if (f == null || f.unwantedParams == null) {
                return {};
              } const h = []; g(f.unwantedParams, (a) => {
                Object.prototype.hasOwnProperty.call(e, a) && (h.push(a), delete e[a]);
              }); a.performanceMark('fbevents:end:unwantedParamsProcessing', b.id); return h.length > 0 ? { spb: h.join(',') } : {};
            });
          });
        })(); return e.exports;
      }(a, b, c, d));
    }); e.exports = f.getFbeventsModules('SignalsFBEvents.plugins.unwantedparams'); f.registerPlugin && f.registerPlugin('fbevents.plugins.unwantedparams', e.exports);
    f.ensureModuleRegistered('fbevents.plugins.unwantedparams', () => {
      return e.exports;
    });
  })();
})(window, document, location, history);
(function (a, b, c, d) {
  const e = { exports: {} }; e.exports; (function () {
    const f = a.fbq; f.execStart = a.performance && a.performance.now && a.performance.now(); if (!(function () {
      const b = a.postMessage || function () {}; if (!f) {
        b({ action: 'FB_LOG', logType: 'Facebook Pixel Error', logMessage: 'Pixel code is not installed correctly on this page' }, '*'); 'error' in console && console.error('Facebook Pixel Error: Pixel code is not installed correctly on this page'); return !1;
      } return !0;
    }())) {
      return;
    } f.__fbeventsModules || (f.__fbeventsModules = {}, f.__fbeventsResolvedModules = {}, f.getFbeventsModules = function (a) {
      f.__fbeventsResolvedModules[a] || (f.__fbeventsResolvedModules[a] = f.__fbeventsModules[a]()); return f.__fbeventsResolvedModules[a];
    }, f.fbIsModuleLoaded = function (a) {
      return !!f.__fbeventsModules[a];
    }, f.ensureModuleRegistered = function (b, a) {
      f.fbIsModuleLoaded(b) || (f.__fbeventsModules[b] = a);
    });
    f.ensureModuleRegistered('SignalsFBEvents.plugins.standardparamchecks', () => {
      return (function (a, b, c, d) {
        const e = { exports: {} }; e.exports; (function () {
          'use strict'; let a = f.getFbeventsModules('SignalsFBEventsLogging'); const b = a.logUserError; a = f.getFbeventsModules('SignalsFBEventsEvents'); const c = a.lateValidateCustomParameters; const d = f.getFbeventsModules('SignalsFBEventsConfigStore'); a = f.getFbeventsModules('SignalsFBEventsPlugin'); f.getFbeventsModules('SignalsParamList'); const g = f.getFbeventsModules('SignalsFBEventsUtils'); const h = g.each; const i = g.some; const j = g.keys; g.isNumber; function k(a, b) {
            if (!b) {
              return !1;
            } return b.require_exact_match
              ? i(b.potential_matches, (b) => {
                return b.toLowerCase() === a.toLowerCase();
              })
              : i(b.potential_matches, (b) => {
                return new RegExp(b).test(a);
              });
          }e.exports = new a((a, e) => {
            c.listen((a, c, f) => {
              f = e.optIns.isOptedIn(a, 'StandardParamChecks'); if (!f) {
                return {};
              } const g = d.get(a, 'standardParamChecks'); if (g == null || g.standardParamChecks == null) {
                return {};
              } const l = []; h(j(c), (d) => {
                let e = g.standardParamChecks[d] || []; if (!e || e.length == 0) {
                  return {};
                } e = i(e, (a) => {
                  return k(String(c[d]), a);
                }); e || (l.push(d), b({ invalidParamName: d, pixelID: a, type: 'INVALID_PARAM_FORMAT' }));
              }); h(l, (a) => {
                delete c[a];
              }); return l.length > 0 ? { rks: l.join(',') } : {};
            });
          });
        })(); return e.exports;
      }(a, b, c, d));
    }); e.exports = f.getFbeventsModules('SignalsFBEvents.plugins.standardparamchecks'); f.registerPlugin && f.registerPlugin('fbevents.plugins.standardparamchecks', e.exports);
    f.ensureModuleRegistered('fbevents.plugins.standardparamchecks', () => {
      return e.exports;
    });
  })();
})(window, document, location, history);
(function (a, b, c, d) {
  const e = { exports: {} }; e.exports; (function () {
    const f = a.fbq; f.execStart = a.performance && a.performance.now && a.performance.now(); if (!(function () {
      const b = a.postMessage || function () {}; if (!f) {
        b({ action: 'FB_LOG', logType: 'Facebook Pixel Error', logMessage: 'Pixel code is not installed correctly on this page' }, '*'); 'error' in console && console.error('Facebook Pixel Error: Pixel code is not installed correctly on this page'); return !1;
      } return !0;
    }())) {
      return;
    } f.__fbeventsModules || (f.__fbeventsModules = {}, f.__fbeventsResolvedModules = {}, f.getFbeventsModules = function (a) {
      f.__fbeventsResolvedModules[a] || (f.__fbeventsResolvedModules[a] = f.__fbeventsModules[a]()); return f.__fbeventsResolvedModules[a];
    }, f.fbIsModuleLoaded = function (a) {
      return !!f.__fbeventsModules[a];
    }, f.ensureModuleRegistered = function (b, a) {
      f.fbIsModuleLoaded(b) || (f.__fbeventsModules[b] = a);
    });
    f.ensureModuleRegistered('SignalsFBEvents.plugins.gating', () => {
      return (function (a, b, c, d) {
        const e = { exports: {} }; e.exports; (function () {
          'use strict'; const a = f.getFbeventsModules('SignalsFBEventsPlugin'); e.exports = new a((a, b) => { });
        })(); return e.exports;
      }(a, b, c, d));
    }); e.exports = f.getFbeventsModules('SignalsFBEvents.plugins.gating'); f.registerPlugin && f.registerPlugin('fbevents.plugins.gating', e.exports);
    f.ensureModuleRegistered('fbevents.plugins.gating', () => {
      return e.exports;
    });
  })();
})(window, document, location, history);
(function (a, b, c, d) {
  const e = { exports: {} }; e.exports; (function () {
    const f = a.fbq; f.execStart = a.performance && a.performance.now && a.performance.now(); if (!(function () {
      const b = a.postMessage || function () {}; if (!f) {
        b({ action: 'FB_LOG', logType: 'Facebook Pixel Error', logMessage: 'Pixel code is not installed correctly on this page' }, '*'); 'error' in console && console.error('Facebook Pixel Error: Pixel code is not installed correctly on this page'); return !1;
      } return !0;
    }())) {
      return;
    } function g(a) {
      return g = typeof Symbol == 'function' && typeof (typeof Symbol === 'function' ? Symbol.iterator : '@@iterator') == 'symbol'
        ? function (a) {
          return typeof a;
        }
        : function (a) {
          return a && typeof Symbol == 'function' && a.constructor === Symbol && a !== (typeof Symbol === 'function' ? Symbol.prototype : '@@prototype') ? 'symbol' : typeof a;
        }, g(a);
    } function h(a, b) {
      const c = Object.keys(a); if (Object.getOwnPropertySymbols) {
        let d = Object.getOwnPropertySymbols(a); b && (d = d.filter((b) => {
          return Object.getOwnPropertyDescriptor(a, b).enumerable;
        })), c.push.apply(c, d);
      } return c;
    } function i(a) {
      for (let b = 1; b < arguments.length; b++) {
        var c = arguments[b] != null ? arguments[b] : {}; b % 2
          ? h(Object(c), !0).forEach((b) => {
            j(a, b, c[b]);
          })
          : Object.getOwnPropertyDescriptors
            ? Object.defineProperties(a, Object.getOwnPropertyDescriptors(c))
            : h(Object(c)).forEach((b) => {
              Object.defineProperty(a, b, Object.getOwnPropertyDescriptor(c, b));
            });
      } return a;
    } function j(a, b, c) {
      return (b = k(b)) in a ? Object.defineProperty(a, b, { value: c, enumerable: !0, configurable: !0, writable: !0 }) : a[b] = c, a;
    } function k(a) {
      a = l(a, 'string'); return g(a) == 'symbol' ? a : `${a}`;
    } function l(a, b) {
      if (g(a) != 'object' || !a) {
        return a;
      } let c = a[typeof Symbol === 'function' ? Symbol.toPrimitive : '@@toPrimitive']; if (void 0 !== c) {
        c = c.call(a, b || 'default'); if (g(c) != 'object') {
          return c;
        } throw new TypeError('@@toPrimitive must return a primitive value.');
      } return (b === 'string' ? String : Number)(a);
    } function m(a, b) {
      return q(a) || n(a, b) || t(a, b) || p();
    } function n(a, b) {
      let c = a == null ? null : typeof Symbol != 'undefined' && a[typeof Symbol === 'function' ? Symbol.iterator : '@@iterator'] || a['@@iterator']; if (c != null) {
        let d; let e; const f = []; let g = !0; let h = !1; try {
          if (a = (c = c.call(a)).next, b === 0) {
            if (Object(c) !== c) {
              return;
            } g = !1;
          } else {
            for (;!(g = (d = a.call(c)).done) && (f.push(d.value), f.length !== b); g = !0) {
              ;
            }
          }
        } catch (a) {
          h = !0, e = a;
        } finally {
          try {
            if (!g && c.return != null && (d = c.return(), Object(d) !== d)) {
              return;
            }
          } finally {
            if (h) {
              throw e;
            }
          }
        } return f;
      }
    } function o(a) {
      return q(a) || u(a) || t(a) || p();
    } function p() {
      throw new TypeError('Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.');
    } function q(a) {
      if (Array.isArray(a)) {
        return a;
      }
    } function r(a) {
      return v(a) || u(a) || t(a) || s();
    } function s() {
      throw new TypeError('Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.');
    } function t(a, b) {
      if (a) {
        if (typeof a == 'string') {
          return w(a, b);
        } let c = {}.toString.call(a).slice(8, -1); return c === 'Object' && a.constructor && (c = a.constructor.name), c === 'Map' || c === 'Set' ? Array.from(a) : c === 'Arguments' || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(c) ? w(a, b) : void 0;
      }
    } function u(a) {
      if (typeof Symbol != 'undefined' && a[typeof Symbol === 'function' ? Symbol.iterator : '@@iterator'] != null || a['@@iterator'] != null) {
        return Array.from(a);
      }
    } function v(a) {
      if (Array.isArray(a)) {
        return w(a);
      }
    } function w(a, b) {
      (b == null || b > a.length) && (b = a.length); for (var c = 0, d = Array(b); c < b; c++) {
        d[c] = a[c];
      } return d;
    }f.__fbeventsModules || (f.__fbeventsModules = {}, f.__fbeventsResolvedModules = {}, f.getFbeventsModules = function (a) {
      f.__fbeventsResolvedModules[a] || (f.__fbeventsResolvedModules[a] = f.__fbeventsModules[a]()); return f.__fbeventsResolvedModules[a];
    }, f.fbIsModuleLoaded = function (a) {
      return !!f.__fbeventsModules[a];
    }, f.ensureModuleRegistered = function (b, a) {
      f.fbIsModuleLoaded(b) || (f.__fbeventsModules[b] = a);
    });
    f.ensureModuleRegistered('SignalsFBEvents', () => {
      return (function (g, h, j, k) {
        const l = { exports: {} }; l.exports; (function () {
          'use strict'; const a = g.fbq; a.execStart = g.performance && typeof g.performance.now === 'function' ? g.performance.now() : null; a.performanceMark = function (a, b) {
            const c = g.fbq && g.fbq._releaseSegment ? g.fbq._releaseSegment : 'unknown'; if (c !== 'canary') {
              return;
            } g.performance != null && typeof g.performance.mark === 'function' && (b != null ? g.performance.mark(''.concat(a, '_').concat(b)) : g.performance.mark(a));
          }; const b = a.getFbeventsModules('SignalsFBEventsNetworkConfig'); const c = a.getFbeventsModules('SignalsFBEventsQE'); const d = a.getFbeventsModules('SignalsParamList'); let e = a.getFbeventsModules('signalsFBEventsSendEvent'); const n = e.sendEvent; e = a.getFbeventsModules('SignalsFBEventsUtils'); const p = a.getFbeventsModules('SignalsFBEventsLogging'); const q = a.getFbeventsModules('SignalsEventValidation'); const s = a.getFbeventsModules('handleEventIdOverride'); const t = a.getFbeventsModules('SignalsFBEventsFBQ'); const u = a.getFbeventsModules('SignalsFBEventsJSLoader'); const v = a.getFbeventsModules('SignalsFBEventsFireLock'); const w = a.getFbeventsModules('SignalsFBEventsMobileAppBridge'); const x = a.getFbeventsModules('signalsFBEventsInjectMethod'); const y = a.getFbeventsModules('signalsFBEventsMakeSafe'); const aa = a.getFbeventsModules('signalsFBEventsResolveLegacyArguments'); const ba = a.getFbeventsModules('SignalsFBEventsPluginManager'); const ca = a.getFbeventsModules('signalsFBEventsCoercePixelID'); const z = a.getFbeventsModules('SignalsFBEventsEvents'); let A = a.getFbeventsModules('SignalsFBEventsTyped'); const B = A.coerce; const C = A.Typed; const D = a.getFbeventsModules('SignalsFBEventsGuardrail'); const da = a.getFbeventsModules('SignalsFBEventsModuleEncodings'); const ea = a.getFbeventsModules('signalsFBEventsDoAutomaticMatching'); const fa = a.getFbeventsModules('SignalsFBEventsTrackEventEvent'); A = a.getFbeventsModules('SignalsFBEventsCensor'); const ga = A.getCensoredPayload; A = a.getFbeventsModules('SignalsFBEventsLogging'); const E = A.logInfo; const F = e.each; A = e.FBSet; const G = e.isEmptyObject; const H = e.isPlainObject; const ha = e.isNumber; const I = e.keys; const J = e.stringStartsWith; e = z.execEnd; const K = z.fired; const L = z.getCustomParameters; const ia = z.iwlBootstrap; const M = z.piiInvalidated; const ja = z.setIWLExtractors; const ka = z.validateCustomParameters; const la = z.validateUrlParameters; const ma = z.setESTRules; const na = z.setCCRules; const N = z.automaticPageView; const O = z.webchatEvent; const oa = a.getFbeventsModules('SignalsFBEventsCorrectPIIPlacement'); const pa = a.getFbeventsModules('SignalsFBEventsProcessEmailAddress'); const qa = a.getFbeventsModules('SignalsFBEventsAddGmailSuffixToEmail'); const P = a.getFbeventsModules('SignalsFBEventsQE'); const ra = a.getFbeventsModules('SignalsFBEventsQEV2'); const Q = a.getFbeventsModules('signalsFBEventsFeatureGate'); const R = p.logError; const S = p.logUserError; const T = v.global; let U = -1; const sa = 'b68919aff001d8366249403a2544fba2d833084f1ad22839b6310aadacb6a138'; const ta = Array.prototype.slice; const V = Object.prototype.hasOwnProperty; let ua = j.href; let va = !1; let wa = !1; const W = []; const X = {}; let xa; h.referrer; const ya = { PageView: new A(), PixelInitialized: new A() }; const Y = new t(a, X); const Z = new ba(Y, T); const za = new A(['eid']); const Aa = 'pixel'; const Ba = 'SignalsFBEvents'; function Ca(a) {
            for (const b in a) {
              V.call(a, b) && (this[b] = a[b]);
            } return this;
          } function Da() {
            try {
              const b = ta.call(arguments); if (T.isLocked() && b[0] !== 'consent') {
                a.queue.push(arguments); return;
              } const c = aa(b); const d = r(c.args); const e = c.isLegacySyntax; const f = d.shift(); switch (f) {
                case 'addPixelId':va = !0; Fa.apply(this, d); break; case 'init':wa = !0; Fa.apply(this, d); break; case 'set':Ea.apply(this, d); break; case 'track':if (ha(d[0])) {
                  Oa.apply(this, d); break;
                } if (e) {
                    Ja.apply(this, d); break;
                  }Ia.apply(this, d); break; case 'trackCustom':Ja.apply(this, d); break; case 'trackShopify':La.apply(this, d); break; case 'trackWebchat':Ka.apply(this, d); break; case 'send':Pa.apply(this, d); break; case 'on':var g = o(d); var h = g[0]; var i = g.slice(1); var j = z[h]; j && j.triggerWeakly(i); break; case 'loadPlugin':Z.loadPlugin(d[0]); break; case 'disabledExtensions':var k = m(d, 1); var l = k[0]; Y.pluginConfig.set(null, 'disabledExtensions', { disabledExtensions: l }); break; case 'dataProcessingOptions':switch (d.length) {
                  case 1:var n = m(d, 1); var p = n[0]; Y.pluginConfig.set(null, 'dataProcessingOptions', { dataProcessingOptions: p, dataProcessingCountry: null, dataProcessingState: null }); break; case 3:var q = m(d, 3); var s = q[0]; var t = q[1]; var u = q[2]; Y.pluginConfig.set(null, 'dataProcessingOptions', { dataProcessingOptions: s, dataProcessingCountry: t, dataProcessingState: u }); break; case 4:var v = m(d, 3); var w = v[0]; var x = v[1]; var y = v[2]; Y.pluginConfig.set(null, 'dataProcessingOptions', { dataProcessingOptions: w, dataProcessingCountry: x, dataProcessingState: y }); break;
                } break; default:Y.callMethod(arguments); break;
              }
            } catch (a) {
              R(a);
            }
          } function Ea(d) {
            for (var e = arguments.length, f = Array.from({ length: e > 1 ? e - 1 : 0 }), g = 1; g < e; g++) {
              f[g - 1] = arguments[g];
            } const h = [d].concat(f); switch (d) {
              case 'endpoint':var j = f[0]; if (typeof j !== 'string') {
                throw new TypeError('endpoint value must be a string');
              } b.ENDPOINT = j; break; case 'cdn':var k = f[0]; if (typeof k !== 'string') {
                throw new TypeError('cdn value must be a string');
              } u.CONFIG.CDN_BASE_URL = k; break; case 'releaseSegment':var l = f[0]; if (typeof l !== 'string') {
                S({ invalidParamName: 'new_release_segment', invalidParamValue: l, method: 'set', params: h, type: 'INVALID_FBQ_METHOD_PARAMETER' }); break;
              }a._releaseSegment = l; break; case 'autoConfig':var m = f[0]; var n = f[1]; var o = m === !0 || m === 'true' ? 'optIn' : 'optOut'; typeof n === 'string' ? Y.callMethod([o, n, 'AutomaticSetup']) : n === void 0 ? Y.disableAutoConfig = o === 'optOut' : S({ invalidParamName: 'pixel_id', invalidParamValue: n, method: 'set', params: h, type: 'INVALID_FBQ_METHOD_PARAMETER' }); break; case 'firstPartyCookies':var p = f[0]; var r = f[1]; var s = p === !0 || p === 'true' ? 'optIn' : 'optOut'; typeof r === 'string' ? Y.callMethod([s, r, 'FirstPartyCookies']) : r === void 0 ? Y.disableFirstPartyCookies = s === 'optOut' : S({ invalidParamName: 'pixel_id', invalidParamValue: r, method: 'set', params: h, type: 'INVALID_FBQ_METHOD_PARAMETER' }); break; case 'experiments':c.setExperiments.apply(c, f); break; case 'experimentsV2':ra.setExperiments.apply(ra, f); break; case 'guardrails':D.setGuardrails.apply(D, f); break; case 'moduleEncodings':da.setModuleEncodings.apply(da, f); break; case 'mobileBridge':var t = f[0]; var v = f[1]; if (typeof t !== 'string') {
                S({ invalidParamName: 'pixel_id', invalidParamValue: t, method: 'set', params: h, type: 'INVALID_FBQ_METHOD_PARAMETER' }); break;
              } if (typeof v !== 'string') {
                  S({ invalidParamName: 'app_id', invalidParamValue: v, method: 'set', params: h, type: 'INVALID_FBQ_METHOD_PARAMETER' }); break;
                }w.registerBridge([t, v]); break; case 'iwlExtractors':var x = f[0]; var y = f[1]; ja.triggerWeakly({ extractors: y, pixelID: x }); break; case 'estRules':var aa = f[0]; var ba = f[1]; ma.triggerWeakly({ rules: ba, pixelID: aa }); break; case 'ccRules':var ca = f[0]; var z = f[1]; na.triggerWeakly({ rules: z, pixelID: ca }); break; case 'startIWLBootstrap':var A = f[0]; var fa = f[1]; ia.triggerWeakly({ graphToken: A, pixelID: fa }); break; case 'parallelfire':var ga = f[0]; var E = f[1]; Y.pluginConfig.set(ga, 'parallelfire', { target: E }); break; case 'openbridge':var F = f[0]; var G = f[1]; F !== null && G !== null && typeof F === 'string' && typeof G === 'string' && (Y.callMethod(['optIn', F, 'OpenBridge']), Y.pluginConfig.set(F, 'openbridge', { endpoints: [{ endpoint: G }] })); break; case 'trackSingleOnly':var ha = f[0]; var I = f[1]; var J = B(ha, C.boolean()); var K = B(I, C.fbid()); if (K == null) {
                S({ invalidParamName: 'pixel_id', invalidParamValue: I, method: 'set', params: h, type: 'INVALID_FBQ_METHOD_PARAMETER' }); break;
              } if (J == null) {
                  S({ invalidParamName: 'on_or_off', invalidParamValue: ha, method: 'set', params: h, type: 'INVALID_FBQ_METHOD_PARAMETER' }); break;
                } var L = q.validateMetadata(d); L.error && S(L.error); L.warnings && L.warnings.forEach((a) => {
                  S(a);
                }); V.call(X, K) ? X[K].trackSingleOnly = J : S({ metadataValue: d, pixelID: K, type: 'SET_METADATA_ON_UNINITIALIZED_PIXEL_ID' }); break; case 'userData':var M = f[0]; var ka = M == null || H(M); if (!ka) {
                S({ invalidParamName: 'user_data', invalidParamValue: M, method: 'set', params: h, type: 'INVALID_FBQ_METHOD_PARAMETER' }); return;
              } var la = i({}, M); for (let N = 0; N < W.length; N++) {
                  const O = W[N]; const oa = Y.optIns.isOptedIn(O.id, 'AutomaticMatching'); const pa = Y.optIns.isOptedIn(O.id, 'ShopifyAppIntegratedPixel'); !Q('enable_shopify_additional_events', O.id) && pa && M && V.call(M, 'external_id') && delete M.external_id; oa && pa ? ea(Y, O, M, la) : S({ invalidParamName: 'pixel_id', invalidParamValue: O.id, method: 'set', params: h, type: 'INVALID_FBQ_METHOD_PARAMETER' });
                } break; default:var qa = Y.pluginConfig.getWithGlobalFallback(null, 'dataProcessingOptions'); var P = qa != null && qa.dataProcessingOptions.includes('LDU'); var R = f[0]; var T = f[1]; if (typeof d !== 'string') {
                throw new TypeError('The metadata setting provided in the \'set\' call is invalid.');
              } if (typeof R !== 'string') {
                  if (P) {
                    break;
                  } S({ invalidParamName: 'value', invalidParamValue: R, method: 'set', params: h, type: 'INVALID_FBQ_METHOD_PARAMETER' }); break;
                } if (typeof T !== 'string') {
                  if (P) {
                    break;
                  } S({ invalidParamName: 'pixel_id', invalidParamValue: T, method: 'set', params: h, type: 'INVALID_FBQ_METHOD_PARAMETER' }); break;
                }Ha(d, R, T); break;
            }
          }a._initHandlers = []; a._initsDone = {}; function Fa(a, b, c) {
            try {
              U = U === -1 ? Date.now() : U; const d = ca(a); if (d == null) {
                return;
              } const e = b == null || H(b); e || S({ invalidParamName: 'user_data', invalidParamValue: b, method: 'init', params: [a, b], type: 'INVALID_FBQ_METHOD_PARAMETER' }); a = D.eval('send_censored_ph', d) || D.eval('send_censored_em', d); let f = {}; e && a && (f = ga(b || {})); a = null; b != null && (a = i({}, b), b = pa(b), b = oa(b), b = qa(b)); const g = Y.pluginConfig.get(d, 'protectedDataMode'); let h = Y.optIns.isOptedIn(d, 'ProtectedDataMode'); let j = !0; h && g != null && g.disableAM && (j = !1); if (V.call(X, d)) {
                b != null && G(X[d].userData) ? (X[d].userData = j && e ? b || {} : {}, X[d].alternateUserData = j && e ? a || {} : {}, X[d].censoredUserDataFormat = j ? f : {}, Z.loadPlugin('identity')) : S({ pixelID: d, type: 'DUPLICATE_PIXEL_ID' }); return;
              }h = { agent: c ? c.agent : null, eventCount: 0, id: d, userData: j && e ? b || {} : {}, alternateUserData: j && e ? a || {} : {}, userDataFormFields: {}, alternateUserDataFormFields: {}, censoredUserDataFormat: j ? f : {}, censoredUserDataFormatFormFields: {} }; W.push(h); X[d] = h; b != null && Z.loadPlugin('identity'); Y.optIns.isOptedIn(d, 'OpenBridge') && Z.loadPlugin('openbridge3'); Ga(); Y.loadConfig(d);
            } catch (a) {
              R(a, 'pixel', 'Init');
            }
          } function Ga() {
            for (let b = 0; b < a._initHandlers.length; b++) {
              const c = a._initHandlers[b]; a._initsDone[b] || (a._initsDone[b] = {}); for (let d = 0; d < W.length; d++) {
                const e = W[d]; a._initsDone[b][e.id] || (a._initsDone[b][e.id] = !0, c(e));
              }
            }
          } function Ha(a, b, c) {
            var d = q.validateMetadata(a); d.error && S(d.error); d.warnings && d.warnings.forEach((a) => {
              S(a);
            }); if (V.call(X, c)) {
              for (var d = 0, e = W.length; d < e; d++) {
                if (W[d].id === c) {
                  W[d][a] = b; break;
                }
              }
            } else {
              S({ metadataValue: b, pixelID: c, type: 'SET_METADATA_ON_UNINITIALIZED_PIXEL_ID' });
            }
          } function Ia(a, b, c) {
            b = b || {}, q.validateEventAndLog(a, b), a === 'CustomEvent' && typeof b.event === 'string' && (a = b.event), Ja.call(this, a, b, c);
          } function Ja(b, c, e, f) {
            let h = this; const j = !1; let k = null; this == null && (h = new Ca({ allowDuplicatePageViews: !0, isAutomaticPageView: !0 }), k = new d(a.piiTranslator), k.append('ie[a]', '1')); f != null && I(f).length > 0 && (k == null && (k = new d(a.piiTranslator)), Object.keys(f).forEach((a) => {
              k.append(a, f[a]);
            })); try {
              D.eval('reset_init_time_on_spa_page_change') && h.isAutomaticPageView && (U = U !== -1 ? Date.now() : U); for (let l = 0, m = W.length; l < m; l++) {
                const n = W[l]; const o = Date.now().toString(); const p = g.fbq.instance.pluginConfig.get(n.id, 'buffer'); let q = !1; p != null && (q = p.onlyBufferPageView === !0 && P.isInTest('spa_pageview_fix')); q = h.allowDuplicatePageViews || q; h.isAutomaticPageView && (e = i(i({}, e), {}, { isAutomaticPageView: !0 })); if (!(b === 'PageView' && q) && Object.prototype.hasOwnProperty.call(ya, b) && ya[b].has(n.id)) {
                  continue;
                } if (n.trackSingleOnly) {
                  continue;
                } Ta({ customData: c, eventData: e, eventName: b, pixel: n, additionalCustomParams: k, experimentId: o }); Object.prototype.hasOwnProperty.call(ya, b) && ya[b].add(n.id);
              }
            } catch (a) {
              throw a;
            } finally {
              j && P.clearExposure();
            }
          } function Ka(a, b, c, d) {
            try {
              b = b || {}; for (let e = 0, f = W.length; e < f; e++) {
                const g = W[e]; if (g == null || g.id == null) {
                  continue;
                } O.trigger({ pixelID: g.id, eventName: a, customData: b, eventData: c, unsafeCustomParams: d });
              }
            } catch (a) {
              R(a, 'pixel', 'webchat');
            }
          } function La(a, b, c, d, e) {
            const f = Ma(a, b, e); let g = Q('enable_shopify_additional_events', a); if (f && !g) {
              return;
            } g = {}; f && (g = i(i({}, g), {}, { 'ie[f]': '1' })); c = Na(a, b, c, e); q.validateEventAndLog(b, c); b === 'CustomEvent' && typeof c.event === 'string' && (b = c.event); Ja.call(this, b, c, d, g);
          } function Ma(a, b, c) {
            if (b !== 'ViewContent') {
              return !1;
            } a = B(c, C.objectWithFields({ shopify_event_name: C.allowNull(C.string()) })); b = ['collection_viewed', 'cart_viewed']; return (a === null || a === void 0 ? void 0 : a.shopify_event_name) != null && b.includes(a.shopify_event_name);
          } function Na(a, b, c, d) {
            c = c || {}; try {
              if (d == null || Object.keys(d).length === 0) {
                return c;
              } let e = Y.optIns.isOptedIn(a, 'ShopifyAppIntegratedPixel'); if (!e) {
                return c;
              } g.fbq.instance.pluginConfig.get(a, 'gating'); e = Q('content_type_opt', a); const f = Q('enable_product_variant_id', a); const h = Q('enable_shopify_payment_fields', a); a = Q('enable_shopify_search_contents', a); d = B(d, C.objectWithFields({ product_variant_ids: C.allowNull(C.arrayOf(C.stringOrNumber())), content_type_favor_variant: C.allowNull(C.string()), contents: C.allowNull(C.arrayOf(C.allowNull(C.object()))), order_id: C.allowNull(C.stringOrNumber()), payment_method: C.allowNull(C.objectWithFields({ gateway: C.allowNull(C.string()), name: C.allowNull(C.string()), type: C.allowNull(C.string()) })) })); if (d == null) {
                return c;
              } d.order_id != null && (c.order_id = d.order_id); h && d.payment_method != null && (c.payment_method = d.payment_method); if (b === 'Search') {
                a && d.contents != null && d.contents.length > 0 && (c.contents = d.contents); return c;
              }f ? d.contents != null && d.contents.length > 0 && (c.contents = d.contents) : e && (c.content_ids = d.product_variant_ids, c.content_type = d.content_type_favor_variant); return c;
            } catch (a) {
              a.message = '[Shopify]: '.concat(a.message); R(a); return c;
            }
          } function Oa(a, b) {
            const c = Date.now().toString(); Ta({ customData: b, eventName: a, experimentId: c });
          } function Pa(a, b, c) {
            W.forEach((c) => {
              const d = Date.now().toString(); Ta({ customData: b, eventName: a, pixel: c, experimentId: d });
            });
          } function $(a) {
            a = a.toLowerCase().trim(); const b = a.endsWith('@icloud.com'); a = a.endsWith('@privaterelay.appleid.com'); if (b) {
              return 2;
            } if (a) {
              return 1;
            }
          } function Qa(b, c, e, f, g, h) {
            let j = new d(a.piiTranslator); h != null && (j = h); try {
              h = b && b.userData || {}; var k = b && b.censoredUserDataFormat || {}; var l = b && b.censoredUserDataFormatFormFields || {}; var m = b && b.userDataFormFields || {}; const n = b && b.alternateUserDataFormFields || {}; var o = b && b.alternateUserData || {}; let p; var q = {}; const r = {}; var s = h.em; s != null && $(s) && (p = $(s), p === 1 && (q.em = sa)); s = m.em; s != null && $(s) && (p = $(s), p === 1 && (r.em = sa)); s = {}; let t = o.em; t != null && $(t) && (p = $(t), p === 1 && (s.em = sa)); t = {}; var u = n.em; u != null && $(u) && (p = $(u), p === 1 && (t.em = sa)); p != null && j.append('ped', p); k != {} && j.append('cud', k); l != {} && j.append('cudff', l); j.append('ud', i(i({}, h), q), !0); j.append('aud', i(i({}, o), s), !0); j.append('udff', i(i({}, m), r), !0); j.append('audff', i(i({}, n), t), !0);
            } catch (a) {
              M.trigger(b);
            }j.append('v', a.version); a._releaseSegment && j.append('r', a._releaseSegment); j.append('a', b && b.agent ? b.agent : a.agent); b && (j.append('ec', b.eventCount), b.eventCount++); const v = D.eval('use_string_prefix_match_from_util'); u = L.trigger(b, c, e, f, g); F(u, (a) => {
              return F(I(a), (b) => {
                if (j.containsKey(b)) {
                  if (!za.has(b)) {
                    if (b === 'bfs' && H(a[b]) && H(j.get(b))) {
                      var c = j.get(b); c = i(i({}, c), a[b]); j.replaceEntry(b, c);
                    } else {
                      c = j.get(b); const d = a != null ? a[b] : null; c === d ? E(new Error('[SignalsFBEvents] '.concat(b, ' param is the same as the existing value.')), Aa, Ba) : E(new Error('[SignalsFBEvents] '.concat(b, ' param is different from the existing value.')), Aa, Ba); j.replaceEntry(b, d !== null && d !== void 0 ? d : c); !j.containsKey('ie[c]') && !j.containsKey('ie%5Bc%5D') && j.append('ie[c]', 1);
                    }
                  }a && (Ra(b, a[b], v) || Sa(b, a[b], v)) && j.replaceEntry(b, a[b]);
                } else {
                  j.append(b, a[b]);
                }
              });
            }); j.append('it', U); k = b && b.codeless === 'false'; j.append('coo', k); l = Y.pluginConfig.getWithGlobalFallback(b ? b.id : null, 'dataProcessingOptions'); if (l != null) {
              h = l.dataProcessingCountry; q = l.dataProcessingOptions; o = l.dataProcessingState; j.append('dpo', q.join(',')); j.append('dpoco', h); j.append('dpost', o);
            }s = Y.pluginConfig.getWithGlobalFallback(b ? b.id : null, 'disabledExtensions'); if (s != null) {
              m = s.disabledExtensions; j.append('de', m.join(','));
            } return j;
          } function Ra(a, b) {
            const c = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : !1; return (a === 'eid' || a === 'eid%5B%5D') && b && typeof b === 'string' && (c ? J(b, 'ob3_plugin-set') : b.startsWith('ob3_plugin-set'));
          } function Sa(a, b) {
            const c = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : !1; return (a === 'eid' || a === 'eid%5B%5D') && b && typeof b === 'string' && (c ? J(b, 'sgwpixel_plugin-set') : b.startsWith('sgwpixel_plugin-set'));
          } function Ta(a) {
            let b = a.customData; const c = a.eventData; const d = a.eventName; const e = a.pixel; let f = a.additionalCustomParams; a = a.experimentId; b = b || {}; if (e != null && w.pixelHasActiveBridge(e)) {
              w.sendEvent(e, d, b); return;
            } const g = Qa(e, d, b, void 0, c, f); s(c, b, g, e === null || e === void 0 ? void 0 : e.id); fa.trigger({ pixelID: e ? e.id : null, eventName: d, customData: b, eventData: c, eventId: g.getEventId() }); f = ka.trigger(e, b, d); F(f, (a) => {
              a != null && F(I(a), (b) => {
                b != null && g.append(b, a[b]);
              });
            }); f = j.href; const i = h.referrer; const k = {}; f != null && (k.dl = f); i != null && (k.rl = i); G(k) || la.trigger(e, k, d, g); n({ customData: b, customParams: g, eventName: d, id: e ? e.id : null, piiTranslator: null, documentLink: k.dl ? k.dl : '', referrerLink: k.rl ? k.rl : '', eventData: c, experimentId: a }, Y);
          } function Ua() {
            while (g.fbq.queue && g.fbq.queue.length && !T.isLocked()) {
              const a = g.fbq.queue.shift(); Da.apply(g.fbq, a);
            }
          }T.onUnlocked(() => {
            Ua();
          }); a.pixelId && (va = !0, Fa(a.pixelId)); (va && wa || g.fbq !== g._fbq) && S({ type: 'CONFLICTING_VERSIONS' }); W.length > 1 && S({ type: 'MULTIPLE_PIXELS' }); function Va() {
            if (a.disablePushState === !0) {
              return;
            } if (!k.pushState || !k.replaceState) {
              return;
            } const b = y(() => {
              N.trigger(); xa = ua; ua = j.href; if (ua === xa) {
                return;
              } const a = new Ca({ allowDuplicatePageViews: !0, isAutomaticPageView: !0 }); Da.call(a, 'trackCustom', 'PageView');
            }); x(k, 'pushState', b); x(k, 'replaceState', b); g.addEventListener('popstate', b, !1);
          } function Wa() {
            'onpageshow' in g && g.addEventListener('pageshow', (a) => {
              if (a.persisted) {
                N.trigger(); a = new Ca({ allowDuplicatePageViews: !0, isAutomaticPageView: !0 }); Da.call(a, 'trackCustom', 'PageView');
              }
            });
          }K.listenOnce(() => {
            Va(), Wa();
          }); function Xa(b) {
            a._initHandlers.push(b), Ga();
          } function Ya() {
            return { pixelInitializationTime: U, pixels: W };
          } function Za(a) {
            a.instance = Y, a.callMethod = Da, a._initHandlers = [], a._initsDone = {}, a.send = Pa, a.getEventCustomParameters = Qa, a.addInitHandler = Xa, a.getState = Ya, a.init = Fa, a.set = Ea, a.loadPlugin = function (a) {
              return Z.loadPlugin(a);
            }, a.registerPlugin = function (a, b) {
              Z.registerPlugin(a, b);
            };
          }Za(g.fbq); Ua(); l.exports = { doExport: Za }; e.trigger();
        })(); return l.exports;
      }(a, b, c, d));
    }); e.exports = f.getFbeventsModules('SignalsFBEvents'); f.registerPlugin && f.registerPlugin('fbevents', e.exports);
    f.ensureModuleRegistered('fbevents', () => {
      return e.exports;
    });
  })();
})(window, document, location, history);
fbq.registerPlugin('global_config', { __fbEventsPlugin: 1, plugin(fbq, instance, config) {
  fbq.loadPlugin('commonincludes');
  fbq.loadPlugin('identity');
  fbq.loadPlugin('privacysandbox');
  fbq.loadPlugin('opttracking');
  fbq.set('experiments', [{ allocation: 0.01, code: 'c', name: 'no_op_exp', passRate: 0.5 }, { allocation: 0, code: 'd', name: 'config_dedupe', passRate: 1 }, { allocation: 0, code: 'e', name: 'send_fbc_when_no_cookie', passRate: 1 }, { allocation: 0, code: 'f', name: 'send_events_in_batch', passRate: 0 }, { allocation: 0, code: 'h', name: 'set_fbc_cookie_after_config_load', passRate: 0 }, { allocation: 0, code: 'i', name: 'prioritize_send_beacon_in_url', passRate: 0.5 }, { allocation: 0, code: 'j', name: 'fix_fbc_fbp_update', passRate: 0 }, { allocation: 0.05, code: 'k', name: 'process_automatic_parameters', passRate: 0 }, { allocation: 0, code: 'l', name: 'async_param_refactor', passRate: 0.5 }, { allocation: 0.01, code: 'm', name: 'sync_process_event', passRate: 0.5 }, { allocation: 0.04, code: 's', name: 'fix_null_context_passed', passRate: 0.5 }]);
  fbq.set('guardrails', [{ name: 'no_op', code: 'a', passRate: 1, enableForPixels: ['569835061642423'] }, { name: 'extract_extra_microdata', code: 'b', passRate: 0, enableForPixels: [] }, { name: 'sgw_auto_extract', code: 'c', passRate: 1, enableForPixels: ['1296510287734738', '337570375319394'] }, { name: 'multi_eid_fix', code: 'd', passRate: 0, enableForPixels: ['909978539160024'] }, { name: 'use_async_param_refactor', code: 'f', passRate: 1, enableForPixels: ['3421688111417438'] }, { name: 'process_pii_from_shopify', code: 'h', passRate: 1, enableForPixels: [] }, { name: 'send_censored_ph', code: 'f', passRate: 1, enableForPixels: ['569835061642423'] }, { name: 'send_censored_em', code: 'g', passRate: 1, enableForPixels: ['569835061642423'] }, { name: 'fix_fbevent_uri_error', code: 'j', passRate: 1, enableForPixels: [] }, { name: 'send_normalized_ud_format', code: 'e', passRate: 1, enableForPixels: ['569835061642423'] }, { name: 'enable_automatic_parameter_logging', code: 'i', passRate: 1, enableForPixels: [] }, { name: 'release_spa_pageview_fix', code: 'l', passRate: 1, enableForPixels: ['569835061642423'] }, { name: 'fix_duplicate_opt_tracking_param', code: 'm', passRate: 1, enableForPixels: [] }, { name: 'release_fix_null_context_passed', code: 'n', passRate: 1, enableForPixels: [] }, { name: 'reset_init_time_on_spa_page_change', code: 'o', passRate: 1, enableForPixels: [] }, { name: 'fix_missing_event_name_error', code: 'p', passRate: 1, enableForPixels: [] }, { name: 'use_string_prefix_match_from_util', code: 'q', passRate: 1, enableForPixels: [] }, { name: 'get_keywords_from_local_storage', code: 'r', passRate: 0, enableForPixels: ['569835061642423', '1728810767262484', '197307666770807', '568414510204424'] }, { name: 'bot_blocking_client_side_block_enabled', code: 's', passRate: 0, enableForPixels: ['1306783967701444'] }]);
  fbq.set('moduleEncodings', { map: { 'generateEventId': 0, 'handleEventIdOverride': 1, 'normalizeSignalsFBEventsDOBType': 2, 'normalizeSignalsFBEventsEmailType': 3, 'normalizeSignalsFBEventsEnumType': 4, 'normalizeSignalsFBEventsPhoneNumberType': 5, 'normalizeSignalsFBEventsPostalCodeType': 6, 'normalizeSignalsFBEventsStringType': 7, 'SignalsConvertNodeToHTMLElement': 8, 'SignalsEventValidation': 9, 'SignalsFBEventsAddGmailSuffixToEmail': 10, 'SignalsFBEventsAsyncParamUtils': 11, 'SignalsFBEventsAutomaticPageViewEvent': 12, 'SignalsFBEventsBaseEvent': 13, 'SignalsFBEventsBotBlockingConfigTypedef': 14, 'SignalsFBEventsBrowserPropertiesConfigTypedef': 15, 'SignalsFBEventsBufferConfigTypedef': 16, 'SignalsFBEventsCCRuleEvaluatorConfigTypedef': 17, 'SignalsFBEventsCensor': 18, 'SignalsFBEventsClientHintConfigTypedef': 19, 'SignalsFBEventsClientSidePixelForkingConfigTypedef': 20, 'signalsFBEventsCoerceAutomaticMatchingConfig': 21, 'signalsFBEventsCoerceBatchingConfig': 22, 'signalsFBEventsCoerceInferedEventsConfig': 23, 'signalsFBEventsCoerceParameterExtractors': 24, 'signalsFBEventsCoercePixelID': 25, 'SignalsFBEventsCoercePrimitives': 26, 'signalsFBEventsCoerceStandardParameter': 27, 'SignalsFBEventsConfigLoadedEvent': 28, 'SignalsFBEventsConfigStore': 29, 'SignalsFBEventsCookieConfigTypedef': 30, 'SignalsFBEventsCookieDeprecationLabelConfigTypedef': 31, 'SignalsFBEventsCorrectPIIPlacement': 32, 'SignalsFBEventsDataProcessingOptionsConfigTypedef': 33, 'SignalsFBEventsDefaultCustomDataConfigTypedef': 34, 'SignalsFBEventsDisabledExtensionsConfigTypedef': 35, 'signalsFBEventsDoAutomaticMatching': 36, 'SignalsFBEventsESTRuleEngineConfigTypedef': 37, 'SignalsFBEventsEvents': 38, 'SignalsFBEventsEventValidationConfigTypedef': 39, 'SignalsFBEventsExperimentNames': 40, 'SignalsFBEventsExperimentsTypedef': 41, 'SignalsFBEventsExperimentsV2Typedef': 42, 'SignalsFBEventsExtractPII': 43, 'SignalsFBEventsFBQ': 44, 'signalsFBEventsFeatureGate': 45, 'signalsFBEventsFillParamList': 46, 'SignalsFBEventsFilterProtectedModeEvent': 47, 'SignalsFBEventsFiredEvent': 48, 'signalsFBEventsFireEvent': 49, 'SignalsFBEventsFireLock': 50, 'SignalsFBEventsForkEvent': 51, 'SignalsFBEventsGatingConfigTypedef': 52, 'SignalsFBEventsGetAutomaticParametersEvent': 53, 'SignalsFBEventsGetCustomParametersEvent': 54, 'signalsFBEventsGetIsChrome': 55, 'signalsFBEventsGetIsIosInAppBrowser': 56, 'SignalsFBEventsGetIWLParametersEvent': 57, 'SignalsFBEventsGetTimingsEvent': 58, 'SignalsFBEventsGetValidUrl': 59, 'SignalsFBEventsGuardrail': 60, 'SignalsFBEventsGuardrailTypedef': 61, 'SignalsFBEventsIABPCMAEBridgeConfigTypedef': 62, 'SignalsFBEventsImagePixelOpenBridgeConfigTypedef': 63, 'signalsFBEventsInjectMethod': 64, 'signalsFBEventsIsHostMeta': 65, 'signalsFBEventsIsURLFromMeta': 66, 'SignalsFBEventsIWLBootStrapEvent': 67, 'SignalsFBEventsJSLoader': 68, 'SignalsFBEventsLateValidateCustomParametersEvent': 69, 'SignalsFBEventsLegacyExperimentGroupsTypedef': 70, 'SignalsFBEventsLogging': 71, 'signalsFBEventsMakeSafe': 72, 'SignalsFBEventsMessageParamsTypedef': 73, 'SignalsFBEventsMicrodataConfigTypedef': 74, 'SignalsFBEventsMobileAppBridge': 75, 'SignalsFBEventsModuleEncodings': 76, 'SignalsFBEventsModuleEncodingsTypedef': 77, 'SignalsFBEventsNetworkConfig': 78, 'SignalsFBEventsNormalizers': 79, 'SignalsFBEventsOpenBridgeConfigTypedef': 80, 'SignalsFBEventsOptIn': 81, 'SignalsFBEventsParallelFireConfigTypedef': 82, 'SignalsFBEventsPIIAutomatchedEvent': 83, 'SignalsFBEventsPIIConflictingEvent': 84, 'SignalsFBEventsPIIInvalidatedEvent': 85, 'SignalsFBEventsPixelCookie': 86, 'SignalsFBEventsPixelPIISchema': 87, 'SignalsFBEventsPixelTypedef': 88, 'SignalsFBEventsPlugin': 89, 'SignalsFBEventsPluginLoadedEvent': 90, 'SignalsFBEventsPluginManager': 91, 'SignalsFBEventsProcessCCRulesEvent': 92, 'SignalsFBEventsProcessEmailAddress': 93, 'SignalsFBEventsProhibitedPixelConfigTypedef': 94, 'SignalsFBEventsProhibitedSourcesTypedef': 95, 'SignalsFBEventsProtectedDataModeConfigTypedef': 96, 'SignalsFBEventsQE': 97, 'SignalsFBEventsQEV2': 98, 'signalsFBEventsResolveLegacyArguments': 99, 'SignalsFBEventsResolveLink': 100, 'SignalsFBEventsRestrictedDomainsConfigTypedef': 101, 'signalsFBEventsSendBeacon': 102, 'SignalsFBEventsSendCloudbridgeEvent': 103, 'signalsFBEventsSendEvent': 104, 'SignalsFBEventsSendEventEvent': 105, 'signalsFBEventsSendEventImpl': 106, 'signalsFBEventsSendFormPOST': 107, 'signalsFBEventsSendGET': 108, 'SignalsFBEventsSetCCRules': 109, 'SignalsFBEventsSetESTRules': 110, 'SignalsFBEventsSetEventIDEvent': 111, 'SignalsFBEventsSetFilteredEventName': 112, 'SignalsFBEventsSetIWLExtractorsEvent': 113, 'SignalsFBEventsShared': 114, 'SignalsFBEventsShouldRestrictReferrerEvent': 115, 'SignalsFBEventsStandardParamChecksConfigTypedef': 116, 'SignalsFBEventsTelemetry': 117, 'SignalsFBEventsTrackEventEvent': 118, 'SignalsFBEventsTriggerSgwPixelTrackCommandConfigTypedef': 119, 'SignalsFBEventsTyped': 120, 'SignalsFBEventsTypeVersioning': 121, 'SignalsFBEventsUnwantedDataTypedef': 122, 'SignalsFBEventsUnwantedEventNamesConfigTypedef': 123, 'SignalsFBEventsUnwantedEventsConfigTypedef': 124, 'SignalsFBEventsUnwantedParamsConfigTypedef': 125, 'SignalsFBEventsURLMetadataConfigTypedef': 126, 'SignalsFBEventsUtils': 127, 'SignalsFBEventsValidateCustomParametersEvent': 128, 'SignalsFBEventsValidateGetClickIDFromBrowserProperties': 129, 'SignalsFBEventsValidateUrlParametersEvent': 130, 'SignalsFBEventsValidationUtils': 131, 'SignalsFBEventsWebchatConfigTypedef': 132, 'SignalsFBEventsWebChatEvent': 133, 'SignalsParamList': 134, 'SignalsPixelCookieUtils': 135, 'SignalsPixelPIIConstants': 136, 'SignalsPixelPIIUtils': 137, 'SignalsFBEvents': 138, 'SignalsFBEvents.plugins.automaticparameters': 139, '[object Object]': 140, 'SignalsFBEvents.plugins.botblocking': 141, 'SignalsFBEvents.plugins.browserproperties': 142, 'SignalsFBEvents.plugins.buffer': 143, 'SignalsFBEvents.plugins.ccruleevaluator': 144, 'SignalsFBEvents.plugins.clienthint': 145, 'SignalsFBEvents.plugins.clientsidepixelforking': 146, 'SignalsFBEvents.plugins.commonincludes': 147, 'SignalsFBEvents.plugins.cookie': 148, 'SignalsFBEvents.plugins.cookiedeprecationlabel': 149, 'SignalsFBEvents.plugins.debug': 150, 'SignalsFBEvents.plugins.defaultcustomdata': 151, 'SignalsFBEvents.plugins.engagementdata': 152, 'SignalsFBEvents.plugins.estruleengine': 153, 'SignalsFBEvents.plugins.eventvalidation': 154, 'SignalsFBEvents.plugins.gating': 155, 'SignalsFBEvents.plugins.iabpcmaebridge': 156, 'SignalsFBEvents.plugins.identifyintegration': 157, 'SignalsFBEvents.plugins.identity': 158, 'SignalsFBEvents.plugins.imagepixelopenbridge': 159, 'SignalsFBEvents.plugins.inferredevents': 160, 'SignalsFBEvents.plugins.iwlbootstrapper': 161, 'SignalsFBEvents.plugins.iwlparameters': 162, 'SignalsFBEvents.plugins.jsonld_microdata': 163, 'SignalsFBEvents.plugins.lastexternalreferrer': 164, 'SignalsFBEvents.plugins.microdata': 165, 'SignalsFBEvents.plugins.openbridge3': 166, 'SignalsFBEvents.plugins.openbridgerollout': 167, 'SignalsFBEvents.plugins.opttracking': 168, 'SignalsFBEvents.plugins.pagemetadata': 169, 'SignalsFBEvents.plugins.parallelfire': 170, 'SignalsFBEvents.plugins.pdpdataprototype': 171, 'SignalsFBEvents.plugins.performance': 172, 'SignalsFBEvents.plugins.privacysandbox': 173, 'SignalsFBEvents.plugins.prohibitedpixels': 174, 'SignalsFBEvents.plugins.prohibitedsources': 175, 'SignalsFBEvents.plugins.protecteddatamode': 176, 'SignalsFBEvents.plugins.scrolldepth': 177, 'SignalsFBEvents.plugins.shopifyappintegratedpixel': 178, 'SignalsFBEvents.plugins.standardparamchecks': 179, 'SignalsFBEvents.plugins.timespent': 180, 'SignalsFBEvents.plugins.topicsapi': 181, 'SignalsFBEvents.plugins.triggersgwpixeltrackcommand': 182, 'SignalsFBEvents.plugins.unwanteddata': 183, 'SignalsFBEvents.plugins.unwantedeventnames': 184, 'SignalsFBEvents.plugins.unwantedevents': 185, 'SignalsFBEvents.plugins.unwantedparams': 186, 'SignalsFBEvents.plugins.urlmetadata': 187, 'SignalsFBEvents.plugins.urlparamschematization': 188, 'SignalsFBEvents.plugins.webchat': 189, 'SignalsFBEvents.plugins.webpagecontentextractor': 190, 'SignalsFBEvents.plugins.websiteperformance': 191, 'SignalsFBEventsTimespentTracking': 192, 'SignalsFBevents.plugins.automaticmatchingforpartnerintegrations': 193, 'cbsdk_fbevents_embed': 194, 'SignalsFBEventsBlockFlags': 195, 'SignalsFBEventsCCRuleEngine': 196, 'SignalsFBEventsESTCustomData': 197, 'SignalsFBEventsEnums': 198, 'SignalsFBEventsFbcCombiner': 199, 'SignalsFBEventsFormFieldFeaturesType': 200, 'SignalsFBEventsGetIsAndroidChrome': 201, 'SignalsFBEventsLocalStorageUtils': 202, 'SignalsFBEventsOptTrackingOptions': 203, 'SignalsFBEventsPerformanceTiming': 204, 'SignalsFBEventsProxyState': 205, 'SignalsFBEventsTransformToCCInput': 206, 'SignalsFBEventsTypes': 207, 'SignalsFBEventsURLMetadataUtils': 208, 'SignalsFBEventsURLUtil': 209, 'SignalsFBEventsWildcardMatches': 210, 'SignalsInteractionUtil': 211, 'SignalsPageVisibilityUtil': 212, 'SignalsPixelClientSideForkingUtils': 213, 'sha256_with_dependencies_new': 214, 'signalsFBEventsExtractMicrodataSchemas': 215, 'signalsFBEventsGetIsAndroid': 216, 'signalsFBEventsGetIsAndroidIAW': 217, 'signalsFBEventsGetIsChromeInclIOS': 218, 'signalsFBEventsGetIsSafariOrMobileSafari': 219, 'signalsFBEventsGetIsWebview': 220, 'signalsFBEventsGetIwlUrl': 221, 'signalsFBEventsGetTier': 222, 'signalsFBEventsIsHostFacebook': 223, 'signalsFBEventsMakeSafeString': 224, 'signalsFBEventsShouldNotDropCookie': 225, 'SignalsFBEventsAutomaticEventsTypes': 226, 'SignalsFBEventsFeatureCounter': 227, 'SignalsFBEventsThrottler': 228, 'signalsFBEventsCollapseUserData': 229, 'signalsFBEventsElementDoesMatch': 230, 'signalsFBEventsExtractButtonFeatures': 231, 'signalsFBEventsExtractEventPayload': 232, 'signalsFBEventsExtractForm': 233, 'signalsFBEventsExtractFormFieldFeatures': 234, 'signalsFBEventsExtractFromInputs': 235, 'signalsFBEventsExtractPageFeatures': 236, 'signalsFBEventsGetTruncatedButtonText': 237, 'signalsFBEventsGetWrappingButton': 238, 'signalsFBEventsIsIWLElement': 239, 'signalsFBEventsIsSaneAndNotDisabledButton': 240, 'signalsFBEventsValidateButtonEventExtractUserData': 241, 'SignalsFBEventsBotDetectionEngine': 242, 'babel.config': 243, 'signalsFBEventsCoerceUserData': 244, 'SignalsFBEventsConfigTypes': 245, 'SignalsFBEventsForkCbsdkEvent': 246, 'getDeepStackTrace': 247, 'getIntegrationCandidates': 248, 'SignalsFBEventsExtractMicrodataFromJsonLdV2': 249, 'SignalsFBEventsExtractMicrodataFromOpenGraphV2': 250, 'SignalsFBEventsExtractMicrodataFromSchemaOrgV2': 251, 'SignalsFBEventsExtractMicrodataUtils': 252, 'SignalsFBEventsMicrodata': 253, 'SignalsEventPayload': 254, 'signalsFBEventsSendXHR': 255, 'ExperimentUtil': 256, 'OpenBridgeConnection': 257, 'OpenBridgeFBLogin': 258, 'ResolveLinks': 259, 'openBridgeDomainFilter': 260, 'openBridgeUserDataUtils': 261, 'PdlWasm': 262, 'PdlWasmTypes': 263, 'WebPDL': 264, 'WebPDLUtility': 265, 'pdl': 266, 'topics_api_utility_lib': 267, 'analytics_debug': 268, 'analytics_ecommerce': 269, 'analytics_enhanced_ecommerce': 270, 'analytics_enhanced_link_attribution': 271, 'analytics_release': 272, 'proxy_polyfill': 273, 'SignalsFBEventsBrowserPropertiesTypedef': 274, 'SignalsFBEventsClientHintTypedef': 275, 'SignalsFBEventsESTRuleConditionTypedef': 276, 'SignalsFBEventsLocalStorageTypedef': 277, 'URLSchematization': 278, 'fbevents_embed': 279, 'AllowableQueryBucketizedValues': 280, 'AllowableQueryKeys': 281, 'AllowableQueryValues': 282, 'EnumExtractor': 283, 'FBIDsExtractor': 284, 'AllowedRegexParameterValue': 285, 'AllowedURLParameterValue': 286, 'BucketedURLParameterValue': 287, 'IURLParameterValue': 288, 'UtmIdFetcher': 289, 'FBIDValidator': 290, 'URLParameterConfig': 291, 'URLSchematizer': 292 }, hash: 'fdfab1132115f4ac7aabc9fd7eee63947594f6e6f1735b47a225dd71217525d3' });
  config.set(null, 'batching', { batchWaitTimeMs: 10, maxBatchSize: 10 });
  config.set(null, 'microdata', { waitTimeMs: 500 });
  fbq.set('experimentsV2', [{ allocation: 1, code: 'pl', name: 'page_load_level_no_op_experiment', passRate: 0.5, universe: 'page_load_level_no_op_universe', evaluationType: 'PAGE_LOAD_LEVEL' }, { allocation: 1, code: 'el', name: 'event_level_no_op_experiment', passRate: 0.5, universe: 'event_level_no_op_universe', evaluationType: 'EVENT_LEVEL' }, { allocation: 1, code: 'bc', name: 'button_click_optimize_experiment_v2', passRate: 1, universe: 'button_click_experiment_universe', evaluationType: 'EVENT_LEVEL' }, { allocation: 0, code: 'se', name: 'process_additional_shopify_events', passRate: 0, universe: 'shopify_events_universe', evaluationType: 'PAGE_LOAD_LEVEL' }, { allocation: 1, code: 'mr', name: 'microdata_refactor_migration', passRate: 0, universe: 'microdata_refactor_migration', evaluationType: 'PAGE_LOAD_LEVEL' }]); instance.configLoaded('global_config');
} });
