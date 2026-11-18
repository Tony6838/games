// ---------------------------------------------------------------------------
// vbsexport.js - rasterise the scoring sheet to a JPEG.
//
// What the result is used for: TakTV.js posts it to LoadCom, which writes it as
// C:\Viking2001\GameCtrl\VTVFile<n>.jpg - the same file the XML renderer writes
// from OpenPlay (Slave/OPENPLAY/Game.cpp), and the same one the reception reads
// over SMB. Only one of the two renderings is live at a time, chosen by "Use HTML
// protocol" on the reception's Setup/Web page, and OpenPlay stops writing that
// file when this one is selected - so there is one writer, not two. It was
// ".html.jpg" while both ran side by side. The caller decides the pixel size; the
// sheet itself is vectors and has none.
//
// Two things this has to work around, both consequences of rasterising an SVG:
//
//  1. An <img> pointed at an SVG will not load anything external - no images, no
//     CSS, no fonts. Every <image href> therefore has to be inlined as a data:
//     URI first. They are fetched once and cached; there are at most ~15 per
//     protocol and they never change while the page is open.
//  2. Drawing an image from another origin taints the canvas and makes
//     toDataURL throw. Served by a slave every image is same-origin already.
//     Under WebView2 the host maps C:\Viking2001 to a virtual host name instead
//     of loading the page from file:// (SetVirtualHostNameToFolderMapping in
//     cRestoreHistoryLaneFile.cpp) - mainly so the theme XML can be fetched at
//     all, and this is kept same-origin by the same mapping. That whole
//     directory is mapped, not just this folder, so that the protocol images can
//     be read from V3GFX where the XML renderer already keeps them - one host
//     name, one origin, no copies.
// ---------------------------------------------------------------------------

/* exported vbsExportSheetJpeg */

var vbsDataUriCache = {};

// Resolves to the data: URI of the picture, or to null when the server does not
// have it. A missing picture must not veto the export: the sheet draws without it
// (an SVG <image> with nothing behind it shows nothing), so the screen is right,
// but until 2026-09-21 the rejection took the whole Promise.all down and
// VTVFile<n>.jpg was never written for a match whose template named a club logo
// the hall never installed - Banp's Hemmalag.png / Bortalag.png in the stress test
// of 2026-09-18, which lost the reception's lane monitor and every image view for
// the match. The miss is cached like a hit, and warned about once, so the missing
// file does not cost a 404 on every render either. Any other failure (a network
// error, a 5xx) still rejects, and is forgotten so the next render retries it -
// a rejected promise used to stay in the cache for the life of the page.
function vbsToDataUri(url) {
  if (vbsDataUriCache[url]) return vbsDataUriCache[url];

  var p = fetch(url)
    .then(function (r) {
      if (r.status === 404) {
        console.warn('Sheet image left out of the export, not found: ' + url);
        return null;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.blob();
    })
    .then(function (blob) {
      if (blob === null) return null;
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { reject(reader.error); };
        reader.readAsDataURL(blob);
      });
    });

  p.catch(function () { delete vbsDataUriCache[url]; });

  vbsDataUriCache[url] = p;
  return p;
}

// Returns a Promise of a data: URL ("data:image/jpeg;base64,...").
function vbsExportSheetJpeg(svg, width, height, quality) {
  var clone = svg.cloneNode(true);
  clone.setAttribute('width', width);
  clone.setAttribute('height', height);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

  var images = clone.querySelectorAll('image');
  var jobs = [];
  for (var i = 0; i < images.length; i++) {
    (function (img) {
      var href = img.getAttribute('href') || img.getAttribute('xlink:href');
      if (!href || href.indexOf('data:') === 0) return;
      jobs.push(vbsToDataUri(new URL(href, window.location.href).href).then(function (uri) {
        if (uri === null) {
          img.parentNode.removeChild(img);   // not on the server: export without it
          return;
        }
        img.setAttribute('href', uri);
        img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', uri);
      }));
    }(images[i]));
  }

  return Promise.all(jobs).then(function () {
    var markup = new XMLSerializer().serializeToString(clone);
    // A data: URI rather than a blob: URL - a blob URL inherits the document
    // origin and would taint the canvas on some hosts, a data: URI never does.
    var svgUri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);

    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext('2d');
        // JPEG has no alpha; without this an area the sheet does not cover comes
        // out black rather than as the page background.
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        try {
          resolve(canvas.toDataURL('image/jpeg', quality || 0.85));
        } catch (error) {
          reject(error);          // tainted canvas - the page is not same-origin
        }
      };
      img.onerror = function () { reject(new Error('could not rasterise the sheet')); };
      img.src = svgUri;
    });
  });
}
