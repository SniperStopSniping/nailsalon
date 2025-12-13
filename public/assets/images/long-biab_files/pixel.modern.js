(function (shopify) {
  (() => {
    const O = 'WebPixel::Render'; const k = c => shopify.extend(O, c); const z = 'https://connect.facebook.net/en_US/fbevents.js'; const W = ['default', 'title', 'default title', '']; function X() {
      window.fbq && typeof window.fbq == 'function' || (window.fbq = function (...c) {
        let b; window.fbq.callMethod ? window.fbq.callMethod.apply(window.fbq, c) : (b = window.fbq.queue) == null || b.push(c);
      }, window._fbq || (window._fbq = window.fbq), window.fbq.push = window.fbq, window.fbq.loaded = !0, window.fbq.version = '2.0', window.fbq.queue = []);
    } function F() {
      const c = document.createElement('script'); return c.setAttribute('async', 'true'), c.setAttribute('src', z), c;
    } function H() {
      let b; const c = document.getElementsByTagName('script')[0]; c === void 0 ? document.head.appendChild(F()) : (b = c.parentNode) == null || b.insertBefore(F(), c);
    }X(); H(); k(({ analytics: c, browser: b, settings: B, init: M, customerPrivacy: R }) => {
      const q = B.pixel_id; function g(t, n, e = {}, o = {}) {
        window.fbq('trackShopify', q, t, e, { eventID: n }, o);
      } function y(t) {
        return (t == null ? void 0 : t.product.id) || (t == null ? void 0 : t.id) || (t == null ? void 0 : t.sku);
      } function h(t) {
        return (t == null ? void 0 : t.id) || (t == null ? void 0 : t.sku) || (t == null ? void 0 : t.product.id);
      } function P(t) {
        const n = []; const e = t.lineItems; if (e != null) {
          for (const o of e) {
            const s = y(o.variant); s != null && n.push(Number.parseInt(s));
          }
        } return n;
      } function A(t) {
        let e; const n = t.lineItems; if (n != null) {
          for (const o of n) {
            if ((e = o.variant) != null && e.product.id) {
              return 'product_group';
            }
          }
        } return 'product';
      } function I(t) {
        const n = []; const e = t.lineItems; if (e != null) {
          for (const o of e) {
            const s = h(o.variant); s != null && n.push(Number.parseInt(s));
          }
        } return n;
      } function D(t) {
        let e, o; const n = t.lineItems; if (n != null) {
          for (const s of n) {
            if ((e = s.variant) != null && e.id || (o = s.variant) != null && o.sku) {
              return 'product';
            }
          }
        } return 'product_group';
      } function x(t) {
        let n = 0; const e = t.lineItems; if (e != null) {
          for (const o of e) {
            n += o.quantity || 1;
          }
        } return n;
      } function E(t) {
        let o, s, u, i, l, r, d, f; const n = []; const e = t.lineItems; if (e != null) {
          for (const p of e) {
            const m = ((o = p.variant) == null ? void 0 : o.product.id) || ((s = p.variant) == null ? void 0 : s.id) || ((u = p.variant) == null ? void 0 : u.sku); const a = ((i = p.variant) == null ? void 0 : i.id) || ((l = p.variant) == null ? void 0 : l.sku) || ((r = p.variant) == null ? void 0 : r.product.id); if (m != null && a != null) {
              const _ = {}; _.id = m ? Number.parseInt(m) : null, _.sku = a ? Number.parseInt(a) : null, _.item_price = ((f = (d = p.variant) == null ? void 0 : d.price) == null ? void 0 : f.amount) || null, _.quantity = p.quantity || 1, _.currency = t.currencyCode || 'USD', n.push(_);
            }
          }
        } return n;
      } function w(t) {
        const n = {}; const e = y(t); const o = h(t); return e != null && o != null && (n.id = e ? Number.parseInt(e) : null, n.sku = o ? Number.parseInt(o) : null, n.item_price = (t == null ? void 0 : t.price.amount) || null, n.currency = (t == null ? void 0 : t.price.currencyCode) || 'USD', n.quantity = 1), n;
      } function j(t) {
        let e, o; const n = t.transactions; if (n != null && n.length > 0) {
          const s = n[0]; const u = s.gateway || ''; const i = ((e = s.paymentMethod) == null ? void 0 : e.name) || ''; const l = ((o = s.paymentMethod) == null ? void 0 : o.type) || ''; const r = {}; return r.gateway = u, r.name = i, r.type = l, r;
        } return null;
      } function S(t, n) {
        return n == null || W.includes(n.toLowerCase()) ? t || '' : `${t} - ${n}`;
      } function v(t) {
        let o, s, u, i, l, r, d, f, p, m, a, _, U, N; const n = {}; n.ct = ((o = t.billingAddress) == null ? void 0 : o.city) || ((s = t.shippingAddress) == null ? void 0 : s.city), n.country = ((u = t.billingAddress) == null ? void 0 : u.countryCode) || ((i = t.shippingAddress) == null ? void 0 : i.countryCode), n.fn = ((l = t.billingAddress) == null ? void 0 : l.firstName) || ((r = t.shippingAddress) == null ? void 0 : r.firstName), n.ln = ((d = t.billingAddress) == null ? void 0 : d.lastName) || ((f = t.shippingAddress) == null ? void 0 : f.lastName), n.ph = t.phone, n.st = ((p = t.billingAddress) == null ? void 0 : p.provinceCode) || ((m = t.shippingAddress) == null ? void 0 : m.provinceCode), n.zp = ((a = t.billingAddress) == null ? void 0 : a.zip) || ((_ = t.shippingAddress) == null ? void 0 : _.zip), n.em = t.email; const e = (N = (U = t.order) == null ? void 0 : U.customer) == null ? void 0 : N.id; e != null && e.length > 0 && (n.external_id = e), window.fbq('set', 'userData', n);
      } function T(t) {
        t ? window.fbq('dataProcessingOptions', []) : window.fbq('dataProcessingOptions', ['LDU'], 0, 0);
      } let C = M.customerPrivacy.saleOfDataAllowed; T(C), window.fbq('init', q, {}, { agent: 'shopify_web_pixel' }), R.subscribe('visitorConsentCollected', (t) => {
        C = t.customerPrivacy.saleOfDataAllowed, T(C);
      }), c.subscribe('page_viewed', (t) => {
        g('PageView', t.id);
      }), c.subscribe('search_submitted', (t) => {
        const n = t.data.searchResult.query || ''; const { productVariants: e } = t.data.searchResult; const o = []; for (const s of e) {
          if (s == null) {
            continue;
          } const u = w(s); o.push(u);
        }g('Search', t.id, { search_string: n }, { contents: o });
      }), c.subscribe('product_viewed', (t) => {
        const { productVariant: n } = t.data; const e = y(n); const o = e ? [Number.parseInt(e)] : []; const s = n.product.id ? 'product_group' : 'product'; const u = S(n.product.title, n.title); const i = n.product.type || ''; const l = n.price.currencyCode || 'USD'; const r = n.price.amount || null; const d = h(n); const f = d ? [Number.parseInt(d)] : []; const p = n.id || n.sku ? 'product' : 'product_group'; const a = [w(n)]; g('ViewContent', t.id, { content_ids: o, content_type: s, content_name: u, content_category: i, currency: l, value: r }, { product_variant_ids: f, content_type_favor_variant: p, contents: a });
      }), c.subscribe('cart_viewed', (t) => {
        let s, u; const { cart: n } = t.data; const e = []; const o = n == null ? void 0 : n.lines; if (o != null && o.length > 0) {
          for (const i of o) {
            const l = y(i == null ? void 0 : i.merchandise); const r = h(i == null ? void 0 : i.merchandise); if (l != null && r != null) {
              const d = {}; d.id = l ? Number.parseInt(l) : null, d.sku = r ? Number.parseInt(r) : null, d.item_price = ((s = i == null ? void 0 : i.merchandise) == null ? void 0 : s.price.amount) || null, d.quantity = (i == null ? void 0 : i.quantity) || 1, d.currency = ((u = i == null ? void 0 : i.merchandise) == null ? void 0 : u.price.currencyCode) || 'USD', e.push(d);
            }
          }
        }g('ViewContent', t.id, { contents: e }, { shopify_event_name: 'cart_viewed' });
      }), c.subscribe('collection_viewed', (t) => {
        const { collection: n } = t.data; const e = n.productVariants; const o = []; for (const s of e) {
          if (s == null) {
            continue;
          } const u = w(s); o.push(u);
        }g('ViewContent', t.id, { contents: o }, { shopify_event_name: 'collection_viewed' });
      }), c.subscribe('product_added_to_cart', (t) => {
        const { cartLine: n } = t.data; const e = y(n == null ? void 0 : n.merchandise); const o = e ? [Number.parseInt(e)] : []; const s = n != null && n.merchandise.product.id ? 'product_group' : 'product'; const u = S(n == null ? void 0 : n.merchandise.product.title, n == null ? void 0 : n.merchandise.title); const i = (n == null ? void 0 : n.merchandise.product.type) || ''; const l = (n == null ? void 0 : n.merchandise.price.currencyCode) || 'USD'; const r = (n == null ? void 0 : n.merchandise.price.amount) || null; const d = (n == null ? void 0 : n.quantity) || 1; const f = h(n == null ? void 0 : n.merchandise); const p = f ? [Number.parseInt(f)] : []; const m = n != null && n.merchandise.id || n != null && n.merchandise.sku ? 'product' : 'product_group'; const a = {}; a.id = e ? Number.parseInt(e) : null, a.sku = f ? Number.parseInt(f) : null, a.item_price = r, a.quantity = d, a.currency = l; const _ = [a]; g('AddToCart', t.id, { content_ids: o, content_type: s, content_name: u, content_category: i, currency: l, value: r, num_items: d }, { product_variant_ids: p, content_type_favor_variant: m, contents: _ });
      }), c.subscribe('checkout_started', (t) => {
        let f; const { checkout: n } = t.data; v(n); const e = P(n); const o = A(n); const s = n.currencyCode || 'USD'; const u = ((f = n.subtotalPrice) == null ? void 0 : f.amount) || 0; const i = x(n); const l = I(n); const r = D(n); const d = E(n); g('InitiateCheckout', t.id, { content_ids: e, content_type: o, currency: s, value: u, num_items: i }, { product_variant_ids: l, content_type_favor_variant: r, contents: d });
      }), c.subscribe('checkout_completed', (t) => {
        let m, a; const { checkout: n } = t.data; v(n); const e = P(n); const o = A(n); const s = n.currencyCode || 'USD'; const u = ((m = n.totalPrice) == null ? void 0 : m.amount) || 0; const i = x(n); const l = I(n); const r = D(n); const d = E(n); const f = (a = n.order) == null ? void 0 : a.id; const p = j(n); g('Purchase', t.id, { content_ids: e, content_type: o, currency: s, value: u, num_items: i }, { product_variant_ids: l, content_type_favor_variant: r, contents: d, order_id: f, payment_method: p });
      }), c.subscribe('payment_info_submitted', (t) => {
        let s; const { checkout: n } = t.data; v(n); const e = n.currencyCode || 'USD'; const o = ((s = n.totalPrice) == null ? void 0 : s.amount) || 0; g('AddPaymentInfo', t.id, { currency: e, value: o });
      });
    });
  })();
})(self.webPixelsManager.createShopifyExtend('111444138', 'app'));
