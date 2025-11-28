/*
* Timely BookButton plugin v1.5
* Example usage:
* var button = new timelyButton('doedayspa');
*
* Booking process can be kicked off manually by calling the start method on the button instance e.g.
* button.start();
*
*/

// Need this for legacy support of older versions of the BookingButton
var timelyButton;

(function () {
    "use strict";

    var mobile = {
        Android: function () {
            return navigator.userAgent.match(/Android/i) ? true : false;
        },
        BlackBerry: function () {
            return navigator.userAgent.match(/BlackBerry/i) ? true : false;
        },
        iOS: function () {
            return navigator.userAgent.match(/iPhone|iPod/i) ? true : false;
        },
        Windows: function () {
            return navigator.userAgent.match(/IEMobile/i) ? true : false;
        },
        any: function () {
            return (mobile.Android() || mobile.BlackBerry() || mobile.iOS() || mobile.Windows());
        }
    };


    timelyButton = function (id, opts) {
        var options = opts || {};

        var businessId = id;
        var resellerCode = options.reseller || resellerCode || '';
        var productId = options.product || productId || '';
        var categoryId = options.category || categoryId || '';
        var staffId = options.staff || staffId || '';
        var locationId = options.location || locationId || '';
        var giftVoucherId = options.giftVoucherId || giftVoucherId || '';
        var isPurchaseButton = options.isPurchaseButton != null ? options.isPurchaseButton : false; // default not a purchase
        var dontCreateButton = !!options.dontCreateButton;
        window.timelyBookFrame = {};
        var style = options.style || 'light';
        var buttonId = options.buttonId || false;
        var bookButton;
        var modalOverlay;
        var renderAsModel = window.innerWidth >= 768 && !mobile.any();
        var scriptSource = (function() {
            var script = document.getElementById('timelyScript');
            if (script.getAttribute.length !== undefined) {
                return script.src;
            }
            return script.getAttribute('src', -1);
        }());

        var clientLoginDomain = (scriptSource.split('.com')[0] + '.com')
            .replace('book', 'bookings')
            .replace('bookingsings', 'clients')
            .replace('http://', 'https://');

        var isOwnImage = !!options.imgSrc;
        var imgButtonType = isPurchaseButton ? 'purchase-buttons' : 'book-buttons';
        var imgSrc = options.imgSrc || getDomain() + '/images/' + imgButtonType + '/button_' + style + '@2x.png?v=5';
        var hoverSrc = getDomain() + '/images/' + imgButtonType + '/button_' + style + '_hover@2x.png?v=5';
        var activeSrc = getDomain() + '/images/' + imgButtonType + '/button_' + style + '_active@2x.png?v=5';

        function init() {
            if (dontCreateButton) return true;
            if (isOwnImage) {
                bookButton = document.createElement('a');
                bookButton.href = generateUrl();
                bookButton.onclick = eventHandler.prototype.Book;
                bookButton.innerHTML = '<img src=\'' + imgSrc + '\' border=\'0\' />';
            } else {
                bookButton = document.createElement('a');
                bookButton.style.backgroundImage = 'url(' + imgSrc + ')';
                bookButton.style.backgroundRepeat = 'no-repeat';
                bookButton.style.backgroundPosition = '0px 0px';
                bookButton.style.backgroundSize = (isPurchaseButton ? '220px' : '162px') + ' 40px';
                bookButton.style.width = isPurchaseButton ? '220px' : '162px';
                bookButton.style.height = '40px';
                bookButton.style.display = 'inline-block';
                bookButton.href = generateUrl();
                bookButton.onclick = eventHandler.prototype.Book;
                bookButton.innerHTML += '<img src="' + hoverSrc + '" style="display:none;" border=\'0\' />';
                bookButton.innerHTML += '<img src="' + activeSrc + '" style="display:none;" border=\'0\' />';
                bookButton.onmouseenter = function() { this.style.backgroundImage = 'url(' + hoverSrc + ')'; };
                bookButton.onmouseout = function () { this.style.backgroundImage = 'url(' + imgSrc + ')'; };
                bookButton.onmousedown = function () { this.style.backgroundImage = 'url(' + activeSrc + ')'; };
                bookButton.onmouseup = function () { this.style.backgroundImage = 'url(' + hoverSrc + ')'; };
            }
            var insertionPoint = findInsertionPoint(buttonId);
            insertAfter(bookButton, insertionPoint);
        }

        function findInsertionPoint(buttonId) {
            var insertionPoint = false;
            if (buttonId) {
                insertionPoint = document.getElementById(buttonId);
            } else {
                if (('currentScript' in document)) {
                    insertionPoint = document.currentScript;
                } else {
                    var scripts = document.getElementsByTagName('script');
                    insertionPoint = scripts[scripts.length - 1];
                }
            }
            return insertionPoint;
        }

        function getDomain() {
            return document.location.protocol + '//' + scriptSource.match( /:\/\/(.[^/]+)/ )[1];
        }

        function generateUrl() {
            var urlPath = ('/' + businessId + '/bb/') + (isPurchaseButton ? 'purchase' : 'book');
            var urlParams = '';

            if (resellerCode) {
                urlParams += '&reseller=' + resellerCode;
            }
            if (productId) {
                urlParams += '&product=' + productId;
            }
            if (categoryId) {
                urlParams += '&category=' + categoryId;
            }
            if (staffId) {
                urlParams += '&staff=' + staffId;
            }
            if (locationId) {
                urlParams += '&location=' + locationId;
            }
            if (giftVoucherId) {
                urlParams += '&giftVoucherId=' + giftVoucherId;
            }

            if (urlParams.length) {
                urlParams = '?' + urlParams.slice(1);
            }

            return clientLoginDomain + urlPath + urlParams;
        }

        function startBooking() {
            var url = generateUrl();

            if (!renderAsModel) {
                window.location.href = url;
                return;
            }

            modalOverlay = document.createElement('div');
            modalOverlay.style.cssText = 'width: 100%; height: 100%; position: fixed; top: 0; left: 0; z-index: 99999999; background-color: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;';
            modalOverlay.addEventListener('click', closeModal);

            window.timelyBookFrame = document.createElement('iframe');
            window.timelyBookFrame.className = 'timely-book-frame';
            window.timelyBookFrame.style.cssText = 'width: 100%; max-width: 730px; height: 100%; max-height: 665px; background-color: #fff; border-radius: 4px; box-shadow: 0 0 26px -1px rgba(33,33,33,.5);';
            window.timelyBookFrame.setAttribute('frameBorder', 0);
            window.timelyBookFrame.setAttribute('allowTransparency', 'true');
            window.timelyBookFrame.src = url;
            window.timelyBookFrame.addEventListener('load', function () {
                var contentWindow = window.timelyBookFrame.contentWindow;
                contentWindow && contentWindow.postMessage({ type: 'timely:client-login:has-modal-wrapper' }, clientLoginDomain);
            });

            modalOverlay.appendChild(window.timelyBookFrame);

            document.getElementsByTagName('body')[0].appendChild(modalOverlay);
        }

        function closeModal (event) {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            if (modalOverlay && modalOverlay.parentNode) {
                modalOverlay.parentNode.removeChild(modalOverlay);
            }
        }

        function insertAfter(f, n) {
            var p = n.parentNode;
            if (n.nextSibling) {
                p.insertBefore(f, n.nextSibling);
            } else {
                p.appendChild(f);
            }
        }

        function eventHandler() {
            // prototype instance
        }

        eventHandler.prototype.Book = function (event) {
            event.preventDefault();
            startBooking();
        };

        window.addEventListener('message', function (event) {
            var isTrusted = event.origin === clientLoginDomain;

            if (!isTrusted) {
                return;
            }

            if (!event.data || !event.data.type) {
                console.warn('Received malformed message, ignoring.');
                return;
            }

            if (event.data.type === 'timely:client-login:close-modal') {
                closeModal();
            }
        });

        init();

        // expose the BookButton API
        return {
            start: function() {
                startBooking();
                return false;
            }
        };
    };
})();
