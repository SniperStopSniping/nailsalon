import { ag as o, ai as n, ap as e, aq as i, B as t, j as r } from './chunk.common_CpVO7qML.esm.js';

function s() {
  return t(this, void 0, void 0, function*() {
    if ('userAgentData' in e && e.userAgentData) {
      try {
        const t = e.userAgentData.brands || []; return t.some(({ brand: t }) => /chrome|edge|chromium/i.test(t));
      } catch (t) {}
    } return !(void 0 === e || !e.userAgent) && (function () {
      const t = e.userAgent; const n = /(chrome|crios)\/([\w.]+)/i.test(t); const r = /(edg|edge|edga|edgios)\/([\w.]+)/i.test(t); const i = /(opr|opera|brave|vivaldi)\/([\w.]+)/i.test(t); return (n || r) && !i;
    }());
  });
} function a(e) {
  return t(this, void 0, void 0, function*() {
    const t = new n('initShopCartSync'); try {
      let t; let n = !1; if (!(yield s())) {
        return;
      } t = r.querySelector('shop-cart-sync'), t || (t = i('shop-cart-sync'), n = !0), t.setAttribute('experiments', JSON.stringify((e == null ? void 0 : e.experiments) || {})), n && r.body.appendChild(t);
    } catch (e) {
      e instanceof Error && t.notify(e);
    }
  });
}o('initShopCartSync', a);
// # sourceMappingURL=client.init-shop-cart-sync_D0dqhulL.en.esm.js.map
