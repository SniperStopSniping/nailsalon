(function () {
  const cdnOrigin = 'https://cdn.shopify.com';
  const scripts = ['/cdn/shopifycloud/checkout-web/assets/c1/polyfills.Ba0kryUm.js', '/cdn/shopifycloud/checkout-web/assets/c1/app.BLArQDYv.js', '/cdn/shopifycloud/checkout-web/assets/c1/locale-en.UXHC-FjC.js', '/cdn/shopifycloud/checkout-web/assets/c1/page-OnePage.CoBnjGd8.js', '/cdn/shopifycloud/checkout-web/assets/c1/LocalizationExtensionField.D5nf2z1H.js', '/cdn/shopifycloud/checkout-web/assets/c1/RememberMeDescriptionText.1nNNmo0r.js', '/cdn/shopifycloud/checkout-web/assets/c1/ShopPayOptInDisclaimer.BfnDmL6R.js', '/cdn/shopifycloud/checkout-web/assets/c1/PaymentButtons.OFe690M_.js', '/cdn/shopifycloud/checkout-web/assets/c1/StockProblemsLineItemList.ChAiPLLo.js', '/cdn/shopifycloud/checkout-web/assets/c1/DeliveryMethodSelectorSection.x-XTbwH-.js', '/cdn/shopifycloud/checkout-web/assets/c1/useEditorShopPayNavigation.-ELK4PNN.js', '/cdn/shopifycloud/checkout-web/assets/c1/VaultedPayment.B5q5rI4Q.js', '/cdn/shopifycloud/checkout-web/assets/c1/SeparatePaymentsNotice.CeyXWaun.js', '/cdn/shopifycloud/checkout-web/assets/c1/ShipmentBreakdown.DmWG3DTh.js', '/cdn/shopifycloud/checkout-web/assets/c1/MerchandiseModal.D4kvkWHk.js', '/cdn/shopifycloud/checkout-web/assets/c1/StackedMerchandisePreview.D08SRaqf.js', '/cdn/shopifycloud/checkout-web/assets/c1/component-ShopPayVerificationSwitch.AGvlt7bE.js', '/cdn/shopifycloud/checkout-web/assets/c1/useSubscribeMessenger.CquQKfwG.js', '/cdn/shopifycloud/checkout-web/assets/c1/index.DReDgNMq.js', '/cdn/shopifycloud/checkout-web/assets/c1/PayButtonSection.BIXN04gI.js'];
  const styles = ['/cdn/shopifycloud/checkout-web/assets/c1/assets/app.Du6SSCMk.css', '/cdn/shopifycloud/checkout-web/assets/c1/assets/OnePage.Dx_lrSVd.css', '/cdn/shopifycloud/checkout-web/assets/c1/assets/DeliveryMethodSelectorSection.BvrdqG-K.css', '/cdn/shopifycloud/checkout-web/assets/c1/assets/ShopPayVerificationSwitch.WW3cs_z5.css', '/cdn/shopifycloud/checkout-web/assets/c1/assets/useEditorShopPayNavigation.CBpWLJzT.css', '/cdn/shopifycloud/checkout-web/assets/c1/assets/VaultedPayment.OxMVm7u-.css', '/cdn/shopifycloud/checkout-web/assets/c1/assets/StackedMerchandisePreview.CKAakmU8.css'];
  const fontPreconnectUrls = [];
  const fontPrefetchUrls = [];
  const imgPrefetchUrls = ['https://cdn.shopify.com/s/files/1/0614/6972/0746/files/1x_-_Wordmark_-_Subline___Arc_x320.png?v=1685461186'];

  function preconnect(url, callback) {
    const link = document.createElement('link');
    link.rel = 'dns-prefetch preconnect';
    link.href = url;
    link.crossOrigin = '';
    link.onload = link.onerror = callback;
    document.head.appendChild(link);
  }

  function preconnectAssets() {
    const resources = [cdnOrigin].concat(fontPreconnectUrls);
    let index = 0;
    (function next() {
      const res = resources[index++];
      if (res) {
        preconnect(res, next);
      }
    })();
  }

  function prefetch(url, as, callback) {
    const link = document.createElement('link');
    if (link.relList.supports('prefetch')) {
      link.rel = 'prefetch';
      link.fetchPriority = 'low';
      link.as = as;
      if (as === 'font') {
        link.type = 'font/woff2';
      }
      link.href = url;
      link.crossOrigin = '';
      link.onload = link.onerror = callback;
      document.head.appendChild(link);
    } else {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.onloadend = callback;
      xhr.send();
    }
  }

  function prefetchAssets() {
    const resources = [].concat(
      scripts.map((url) => {
        return [url, 'script'];
      }),
      styles.map((url) => {
        return [url, 'style'];
      }),
      fontPrefetchUrls.map((url) => {
        return [url, 'font'];
      }),
      imgPrefetchUrls.map((url) => {
        return [url, 'image'];
      }),
    );
    let index = 0;
    function run() {
      const res = resources[index++];
      if (res) {
        prefetch(res[0], res[1], next);
      }
    }
    var next = (self.requestIdleCallback || setTimeout).bind(self, run);
    next();
  }

  function onLoaded() {
    try {
      if (Number.parseFloat(navigator.connection.effectiveType) > 2 && !navigator.connection.saveData) {
        preconnectAssets();
        prefetchAssets();
      }
    } catch (e) {}
  }

  if (document.readyState === 'complete') {
    onLoaded();
  } else {
    addEventListener('load', onLoaded);
  }
})();
