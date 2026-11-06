/*!
 * springy-track — horizontal card track with mouse drag, inertia and a spring at the edges.
 * MIT License. https://github.com/IvanMayorov/springy-track
 *
 * SpringyTrack(track, { slides, prev, next }) — `track` is scrolled horizontally by the browser (scroll-snap in CSS);
 * `slides` — selector of the cards inside (track children by default); `prev` / `next` — arrow buttons
 * (they get the `is-disabled` class at the edges).
 *
 * What it adds:
 * - edge-to-edge track: paddings (--springy-g, --springy-gr) from the window edge to the container, the first card
 *   sits on the container line, cards outside the container fade out towards the window edge (mask in springy-track.css);
 * - the track can be dragged with a mouse; released, it glides on with inertia and settles on a card; past the edge it springs;
 * - arrows scroll by as many cards as are visible, with the same smooth glide.
 * Fingers and touchpads scroll the track natively. The parent of the track needs `overflow-x: clip` (or hidden).
 */
(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.SpringyTrack = factory();
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	var RUBBER = .35;  // past the edge the track moves ~3 times slower than the mouse
	var THROW = 260;   // how far the track glides on inertia: velocity (px/ms) × THROW
	// After release the motion runs on a critically damped spring: no abrupt start and no overshoot.
	// SPRING is the stiffness: lower is smoother and longer (at 7 the motion settles in about 0.8 s).
	var SPRING = 7;

	function SpringyTrack(track, opts) {
		opts = opts || {};
		if (!track || track.springyTrack) return track && track.springyTrack;
		var still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
		var prev = opts.prev, next = opts.next;
		var rubber = opts.rubber != null ? opts.rubber : RUBBER;
		var throwK = opts.throw != null ? opts.throw : THROW;
		var spring = opts.spring != null ? opts.spring : SPRING;
		track.classList.add('springy-track');

		function slides() {
			return opts.slides ? track.querySelectorAll(opts.slides) : track.children;
		}
		// Step — distance between neighbouring cards (width + gap)
		function stepSize() {
			var s = slides();
			if (s.length > 1) return s[1].offsetLeft - s[0].offsetLeft;
			return s[0] ? s[0].offsetWidth : track.clientWidth;
		}
		function maxScroll() { return track.scrollWidth - track.clientWidth; }

		// Paddings up to the window edges. The track measured without paddings is the container line.
		var g = 0;
		function gutter() {
			var x = track.scrollLeft; // while measuring without paddings the browser may clamp the scroll — restore it
			track.style.marginLeft = track.style.marginRight = track.style.paddingLeft = track.style.paddingRight = '0px';
			var r = track.getBoundingClientRect();
			g = Math.max(0, Math.round(r.left));
			var gr = Math.max(0, Math.round(document.documentElement.clientWidth - r.right));
			track.style.marginLeft = -g + 'px';
			track.style.marginRight = -gr + 'px';
			track.style.paddingLeft = g + 'px';
			track.style.paddingRight = gr + 'px';
			track.style.scrollPaddingLeft = g + 'px';
			track.style.scrollPaddingRight = gr + 'px';
			track.style.setProperty('--springy-g', g + 'px');
			track.style.setProperty('--springy-gr', gr + 'px');
			if (track.scrollLeft !== x) track.scrollLeft = x;
			update();
		}

		function update() {
			if (prev) prev.classList.toggle('is-disabled', track.scrollLeft <= 2);
			if (next) next.classList.toggle('is-disabled', track.scrollLeft >= maxScroll() - 2);
		}

		var anim = 0, sc = null, pl = null; // sc — scroll {x, v, to}, pl — pull past the edge {x, v}
		var pullNow = 0;
		function pull(px) { pullNow = px; track.style.setProperty('--springy-pull', px + 'px'); }
		function stopAnim() { cancelAnimationFrame(anim); anim = 0; sc = pl = null; }
		// End of motion: turn snapping back on and set the same scroll again with snapping on, so the browser
		// remembers this card. Otherwise it remembers the card it stood on before the drag (often the first one)
		// and may jump back to it on any relayout (an image loaded, etc.).
		function settle() {
			var x = track.scrollLeft;
			track.classList.remove('is-dragging');
			track.scrollLeft = x;
		}
		function stepSpring(o, to, dt) {
			var w = spring, a = -w * w * (o.x - to) - 2 * w * o.v;
			o.v += a * dt; o.x += o.v * dt;
		}
		function run() {
			if (anim) return;
			var last = performance.now();
			track.classList.add('is-dragging'); // no snapping while it moves
			anim = requestAnimationFrame(function frame(now) {
				var dt = Math.min(.05, (now - last) / 1000); last = now;
				for (var n = 0; n < 4; n++) { // small sub-steps — stable at any frame rate
					if (sc) stepSpring(sc, sc.to, dt / 4);
					if (pl) stepSpring(pl, 0, dt / 4);
				}
				var done = true;
				if (sc) {
					track.scrollLeft = sc.x;
					if (Math.abs(sc.x - sc.to) < .5 && Math.abs(sc.v) < 5) { track.scrollLeft = sc.to; sc = null; } else done = false;
				}
				if (pl) {
					pull(pl.x);
					if (Math.abs(pl.x) < .3 && Math.abs(pl.v) < 5) { pull(0); pl = null; } else done = false;
				}
				if (done || still) {
					if (still) { if (sc) track.scrollLeft = sc.to; pull(0); }
					anim = 0; sc = pl = null; settle();
					return;
				}
				anim = requestAnimationFrame(frame);
			});
		}
		// to — where to scroll, v — initial scroll velocity (px/s)
		function glideTo(to, v) {
			to = Math.min(maxScroll(), Math.max(0, Math.round(to)));
			sc = { x: track.scrollLeft, v: v || (sc ? sc.v : 0), to: to };
			run();
		}
		function release() {
			if (pullNow) { pl = { x: pullNow, v: 0 }; run(); }
		}
		function snapIndex(pos) { return Math.round(pos / stepSize()); }

		// Arrows: by as many cards as fit in the container
		function go(dir) {
			var w = stepSize();
			var visible = Math.max(1, Math.floor((track.clientWidth - g - (parseFloat(track.style.paddingRight) || 0) + 2) / w));
			var idx = snapIndex(track.scrollLeft) + dir * visible;
			if ((dir < 0 && track.scrollLeft <= 2) || (dir > 0 && track.scrollLeft >= maxScroll() - 2)) return;
			glideTo(idx * w);
		}
		function onPrev() { go(-1); }
		function onNext() { go(1); }
		if (prev) prev.addEventListener('click', onPrev);
		if (next) next.addEventListener('click', onNext);

		// Mouse drag
		var drag = null, moved = false;
		function down(e) {
			if (e.pointerType !== 'mouse' || e.button !== 0) return;
			var gliding = !!sc;
			stopAnim();
			// grabbed while springing back from the edge — continue from the same pull, without a jump
			drag = { x: e.clientX, left: track.scrollLeft - pullNow / rubber, vx: 0, lastX: e.clientX, lastT: performance.now(), gliding: gliding };
			moved = false;
		}
		function move(e) {
			if (!drag) return;
			var dx = e.clientX - drag.x;
			if (!moved && Math.abs(dx) < 5) return;
			if (!moved) { moved = true; track.classList.add('is-dragging'); }
			var now = performance.now();
			drag.vx = .6 * (e.clientX - drag.lastX) / Math.max(1, now - drag.lastT) + .4 * drag.vx; // smoothed velocity
			drag.lastX = e.clientX; drag.lastT = now;
			var want = drag.left - dx, max = maxScroll();
			var over = want < 0 ? want : (want > max ? want - max : 0);
			track.scrollLeft = Math.min(max, Math.max(0, want));
			pull(-over * rubber);
		}
		function up() {
			if (!drag) return;
			var d = drag; drag = null;
			release(); // on a plain click too — otherwise a pull grabbed mid-flight would stay
			if (!moved) {
				// a click stopped the glide halfway — finish to the nearest card instead of leaving it between cards
				if (d.gliding) glideTo(snapIndex(track.scrollLeft) * stepSize());
				return;
			}
			// Inertia: if the mouse stopped before release there is no velocity, just the nearest card
			if (performance.now() - d.lastT > 80) d.vx = 0;
			d.vx = Math.max(-3, Math.min(3, d.vx)); // at most 3 px/ms — otherwise one flick throws the track to the end
			var cur = snapIndex(track.scrollLeft), idx = snapIndex(track.scrollLeft - d.vx * throwK);
			if (idx === cur && Math.abs(d.vx) > .3) idx += d.vx < 0 ? 1 : -1;
			glideTo(idx * stepSize(), track.scrollLeft > 0 && track.scrollLeft < maxScroll() ? -d.vx * 1000 : 0);
		}
		// A click after a drag does not follow the link
		function click(e) {
			if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; }
		}
		function dragstart(e) { e.preventDefault(); }

		track.addEventListener('pointerdown', down);
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
		window.addEventListener('pointercancel', up);
		track.addEventListener('click', click, true);
		track.addEventListener('dragstart', dragstart);
		track.addEventListener('scroll', update, { passive: true });
		window.addEventListener('resize', gutter);
		gutter();

		function destroy() {
			stopAnim();
			track.removeEventListener('pointerdown', down);
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			window.removeEventListener('pointercancel', up);
			track.removeEventListener('click', click, true);
			track.removeEventListener('dragstart', dragstart);
			track.removeEventListener('scroll', update);
			window.removeEventListener('resize', gutter);
			if (prev) prev.removeEventListener('click', onPrev);
			if (next) next.removeEventListener('click', onNext);
			['margin-left', 'margin-right', 'padding-left', 'padding-right', 'scroll-padding-left', 'scroll-padding-right',
				'--springy-g', '--springy-gr', '--springy-pull'].forEach(function (p) { track.style.removeProperty(p); });
			track.classList.remove('springy-track', 'is-dragging');
			delete track.springyTrack;
		}

		return (track.springyTrack = { go: go, update: update, refresh: gutter, destroy: destroy });
	}

	return SpringyTrack;
});
