/* The crab: a 22 x 13 pixel Clawd-shaped body with pincers. Shared by the stage
   (canvas), the header mark (SVG) and scripts/make-icons.mjs (PNG). */
(function (root) {
  'use strict';

  var W = 22, H = 13;

  var COLORS = { o: '#FF6A13', h: '#FF9A55', s: '#C2410C', d: '#141110' };

  var BODY = [
    '.....hhhhhhhhhhhh.....',
    '.....oooooooooooo.....',
    '.....oooooooooooo.....',
    '.....oooooooooooo.....',
    '..oooooooooooooooooo..',
    '..oooooooooooooooooo..',
    '.....oooooooooooo.....',
    '.....ssssssssssss.....'
  ];

  var CLAW = {
    open: ['o.o', 'o.o', 'ooo'],
    shut: ['.o.', 'ooo', 'ooo']
  };

  var LEGS = { a: [6, 8, 13, 15], b: [5, 7, 14, 16] };

  var EYES = {
    open: [[7, 5], [7, 6], [14, 5], [14, 6]],
    left: [[6, 5], [6, 6], [13, 5], [13, 6]],
    right: [[8, 5], [8, 6], [15, 5], [15, 6]],
    blink: [[6, 6], [7, 6], [14, 6], [15, 6]],
    happy: [[6, 6], [7, 5], [8, 6], [13, 6], [14, 5], [15, 6]],
    shock: [[7, 5], [8, 5], [7, 6], [8, 6], [13, 5], [14, 5], [13, 6], [14, 6]],
    angry: [[6, 3], [7, 4], [7, 5], [7, 6], [15, 3], [14, 4], [14, 5], [14, 6]]
  };
  EYES.sleep = EYES.blink;

  var cache = {};

  function claw(out, x0, c) {
    var lift = c && c.lift ? c.lift : 0;
    var top = 1 - lift;
    var shape = c && c.shut ? CLAW.shut : CLAW.open;
    for (var r = 0; r < 3; r++) {
      for (var k = 0; k < 3; k++) {
        if (shape[r].charAt(k) === 'o') out.push([x0 + k, top + r, r === 0 ? 'h' : 'o']);
      }
    }
    for (var y = top + 3; y <= 6; y++) out.push([x0 + 1, y, 'o']);
  }

  /* opts: { legs: 'a'|'b'|'none', eyes: key of EYES, clawL: {shut, lift}, clawR: {shut, lift} }
     Returns [x, y, colorKey] triples. Sleeping crabs (legs 'none') sit 2px lower. */
  function pixels(opts) {
    opts = opts || {};
    var key = (opts.legs || 'a') + (opts.eyes || 'open') +
      (opts.clawL ? (opts.clawL.shut ? 1 : 0) + ':' + (opts.clawL.lift || 0) : '0:0') +
      (opts.clawR ? (opts.clawR.shut ? 1 : 0) + ':' + (opts.clawR.lift || 0) : '0:0');
    if (cache[key]) return cache[key];

    var out = [];
    var drop = opts.legs === 'none' ? 2 : 0;
    for (var i = 0; i < BODY.length; i++) {
      var row = BODY[i];
      for (var x = 0; x < W; x++) {
        var ch = row.charAt(x);
        if (ch !== '.') out.push([x, 3 + i + drop, ch]);
      }
    }
    var cl = [];
    claw(cl, 1, opts.clawL);
    claw(cl, 18, opts.clawR);
    for (i = 0; i < cl.length; i++) out.push([cl[i][0], cl[i][1] + drop, cl[i][2]]);

    if (opts.legs !== 'none') {
      var legs = LEGS[opts.legs] || LEGS.a;
      for (i = 0; i < legs.length; i++) {
        out.push([legs[i], 11, 's']);
        out.push([legs[i], 12, 's']);
      }
    }
    var eyes = EYES[opts.eyes] || EYES.open;
    for (i = 0; i < eyes.length; i++) out.push([eyes[i][0], eyes[i][1] + drop, 'd']);

    cache[key] = out;
    return out;
  }

  function svg(opts, colors) {
    colors = colors || COLORS;
    var px = pixels(opts);
    var rects = '';
    for (var i = 0; i < px.length; i++) {
      rects += '<rect x="' + px[i][0] + '" y="' + px[i][1] + '" width="1" height="1" fill="' + colors[px[i][2]] + '"/>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H +
      '" shape-rendering="crispEdges" aria-hidden="true">' + rects + '</svg>';
  }

  var CrabSprite = { w: W, h: H, colors: COLORS, pixels: pixels, svg: svg };

  if (typeof module === 'object' && module.exports) module.exports = CrabSprite;
  else root.CrabSprite = CrabSprite;
})(typeof self !== 'undefined' ? self : this);
