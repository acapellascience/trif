// ==WebMod==
// @name        Simple Shopping
// @description Buy without influence
// @match       https://www.amazon.com/*
// @run-at      document-start
// @risk        1 hides sponsored results and ad slots, so their ad impressions never report (looks like an ad blocker)
// @source      webmods
// @version     2
// ==/WebMod==

(() => {
  // Formerly "Simple results" (amazon.com/simple-results). Merged from hide-left-sidebar,
  // hide-sponsored-results, hide-recommendations, results-price-and-stars and hide-footer. Everything
  // is CSS except the recommendation carousels in search results, which are found by their heading text.
  const R = '.s-main-slot [data-component-type="s-search-result"]';

  // Sponsored rows are marked in several ways:
  //  - .AdHolder on the row (sponsored products, brand banners, video ads)
  //  - a "Sponsored" label inside (.puis-/.s-sponsored-label-text on products,
  //    .s-widget-sponsored-label-text on carousels like "Customers frequently viewed")
  //  - brand widgets ("Sponsored | Shop X") only carry hashed CSS-module classes like
  //    _c2Itd_ctaSponsoredContainer_… and …adFeedback…, so match on the readable part
  //  - ad clicks go through /sspa/click
  const AD = `.puis-sponsored-label-text, .s-sponsored-label-text, .s-widget-sponsored-label-text,
    [class*="ctaSponsored"], [class*="adFeedback"], [class*="ad-feedback"], a[href*="/sspa/click"]`;

  const style = document.createElement('style');
  style.textContent = `
    /* --- Left sidebar ---
       The results page is a .sg-row with two .sg-col columns: the sidebar column holds the widget
       marked slot=LEFT (and #s-refinements), the other holds .s-main-slot. The sg-col-N-of-M classes
       set the main column's width, so override it to take the whole row. */
    .sg-row > .sg-col:has(#s-refinements, [class*="slot=LEFT"]):not(:has(.s-main-slot)) { display: none !important; }
    .sg-row:has(> .sg-col #s-refinements) > .sg-col:has(.s-main-slot) { width: 100% !important; max-width: none !important; }

    /* List-view results: inside each card, the image and text columns get fixed pixel widths from
       breakpoints that assume the sidebar is there, so the text column stops short. Let it take the
       rest of the row. */
    .s-main-slot .puisg-row > .puis-list-col-right { flex: 1 1 0 !important; width: auto !important; max-width: none !important; }

    /* --- Sponsored results (.s-main-slot is the results list, so this does nothing elsewhere) --- */
    .s-main-slot > .AdHolder,
    .s-main-slot > div:has(${AD}) { display: none !important; }

    /* --- Site-wide: the parts Amazon builds the same way on every page ---
       #rhf is the lazy-loaded bottom block of carousels ("Best Sellers in …", "Inspired by your
       browsing history", "Recommended based on your shopping trends"). "dramabot" ids are display
       ad slots; ape_<page>_<slot>_placement are ad slots dropped inside other sections. */
    #rhf,
    [id*="dramabot"],
    .celwidget:has(> [id^="ape_"][id$="_placement"]), [id^="ape_"][id$="_placement"],

    /* --- Added-to-cart page (/cart/smart-wagon): "Based on what you added", "Products related to",
       "Customers who bought this item also bought" --- */
    .sw-atf-recommendations-container,
    #smart-wagon-recommendations-atf,
    #smart-wagon-recommendations-btf,

    /* --- Cart (/gp/cart/view.html): "Customers Who Bought Items in Your Recent History Also Bought"
       down the right, "New international customers purchased" below. Saved for later stays. --- */
    [id^="sc-rec-"],

    /* --- Recommendations in search results --- */
    /* Carousels inside the results list, marked below by their heading */
    .s-main-slot > [data-ahr-hide] { display: none !important; }

    /* --- Price and stars only ---
       Product tiles are [data-component-type=s-search-result] inside .s-main-slot; their parts carry
       data-cy hooks (title-recipe, reviews-block, price-recipe, delivery-recipe, add-to-cart). */
    /* Title, delivery, badges ("Amazon's Choice", "Limited-time deal"), colour swatches */
    ${R} [data-cy="title-recipe"],
    ${R} [data-cy="delivery-recipe"],
    ${R} .a-badge, ${R} .a-badge-region, ${R} [class*="rio-badge"],
    ${R} .s-color-swatch-container { display: none !important; }

    /* Whitelist: in the block under the image, keep only rating, price and the
       "Add to cart" / "See options" buttons (.a-button-stack, in an unlabelled block). Catches the rest
       ("More buying choices" = secondary-offer-recipe, "Recycled materials" certs, swatches, etc.) */
    ${R} :has(> [data-cy="reviews-block"], > [data-cy="price-recipe"]) > :not([data-cy="reviews-block"], [data-cy="price-recipe"], :has(.a-button-stack)) { display: none !important; }

    /* Rating: keep the stars, drop the "4.5" number, the review count and "4K+ bought in past month" */
    ${R} [data-cy="reviews-block"] > .a-row:not(:has(.a-icon-star-mini, [class*="a-star"])),
    ${R} [data-cy="reviews-block"] .a-row > :not(:has(.a-icon-star-mini, [class*="a-star"])):not([class*="a-star"]) { display: none !important; }

    /* Price: keep the main price; drop list/was price, "Price, product page", music offers, eco fees, coupons */
    ${R} [data-cy="price-recipe"] > :not(:has(.a-price:not(.a-text-price))),
    ${R} [data-cy="price-recipe"] .a-text-price,
    ${R} [data-cy="price-recipe"] .a-price ~ *,
    ${R} [data-cy="price-recipe"] .a-row:not(:has(.a-price:not(.a-text-price))) { display: none !important; }

    /* --- Product pages (#dp) ---
       Keep photos, title, price, size/colour pickers, details, buy box and reviews. Hide the rest by
       widget id: ids are stable but some carry a _0/_2 suffix, so match on prefixes. sims- and
       similarities ids are the "also viewed", "bought together", "related products" and "similar
       brands" carousels. (Ad slots and #rhf are covered by the site-wide rules above.) */
    #dp [id^="desktop-dp-ilm"],
    #dp #heroQuickPromoContainer,
    #dp [id^="sims-"],
    #dp [id^="similarities"],
    #dp #climatePledgeFriendlyBTF_feature_div,
    /* "Top / Reviews / Similar" tabs, plus the copy that sticks to the top while scrolling */
    #dp [id^="btfSubNavDesktop"], #dp .btf-sub-nav-desktop-pr,
    #dp #aplus_feature_div,
    #dp #aplusBrandStory_feature_div,
    #dp #va-related-videos-widget_feature_div,
    #dp #crossBorderWidgetCards_feature_div,
    #dp #tellAmazon_feature_div { display: none !important; }

    /* --- Footer ---
       #navFooter starts with the "Back to top" button (#navBackToTop); everything after it
       (link columns, language/country, Amazon services, legal links) is hidden, on every page. */
    #navFooter > :not(#navBackToTop) { display: none !important; }
  `;
  (document.head || document.documentElement).append(style);

  // In-list carousels ("Customers frequently viewed", "Customers also viewed/bought") have no stable
  // class of their own, so match the heading text.
  const HEADING = /^customers (also|frequently) (viewed|bought)|inspired by your browsing history/i;
  const mark = () => {
    const slot = document.querySelector('.s-main-slot');
    if (!slot) return;
    for (const row of slot.children) {
      if (row.hasAttribute('data-ahr-hide')) continue;
      const h = row.querySelector('h2, h3');
      if (h && HEADING.test(h.textContent.trim())) row.setAttribute('data-ahr-hide', '');
    }
  };

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; try { mark(); } catch (e) { window.webmods?.warn(String(e)); } }, 150);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
