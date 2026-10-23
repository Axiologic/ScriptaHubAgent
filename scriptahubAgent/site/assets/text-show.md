# textShow

Copy `text-show.js` and `text-show.css` into any website and load both. No
framework, catalogue data, network request or ScriptaHub styles are required.
Text is escaped, split into sentences with `Intl.Segmenter` where available,
and displayed with progressive word emphasis. Each sentence has time to finish
animating and remain readable. Presentations are finite by default.

```html
<link rel="stylesheet" href="text-show.css">
<p id="description">First sentence. Another sentence.</p>
<script src="text-show.js"></script>
<script>
  const presentation = textShow(document.querySelector('#description'), {
    language: 'en',
    whenVisible: true,
    onComplete(instance) { /* The final sentence has finished its reading hold. */ }
  });
</script>
```

`textShow(element, options)` returns an independent instance. Options:

- `text`: plain text or an array of messages; defaults to the element's text.
- `language`: sentence-segmentation language, default `en`.
- `autoplay`: default `true`; `false` waits for `start()`.
- `whenVisible`: wait for viewport intersection and suspend outside it. The first
  sentence remains readable before playback starts.
- `ready()`: optional loading gate. Call `refresh()` after readiness changes.
- `visibilityTarget`: observe a containing card instead of the text element.
- `loop`: default `false`.
- `onComplete(instance)`, `onChange(instance)`: lifecycle callbacks.
- `render(sentence, index, instance)`: optional custom renderer for an external
  control shell, as used by the home introduction.
- `duration(sentence)`: optional millisecond timing policy; defaults to animation
  time plus a reading hold. A replacement must include both.

Methods: `start()`, `show(index)`, `pause()`, `resume()`, `refresh()`, `destroy()`.
Read-only properties: `index`, `sentences`, `remaining`, `completed`, `visible`.
`show(0)` restarts a finished presentation. `destroy()` cancels timers and
observers and restores original text. Remounting the same element disposes its
previous instance. Unmount presentations before removing their DOM.

The target emits a bubbling `textshow:complete` event after its final reading
hold. The event's `detail.instance` is the completed player. Visibility loss and
hidden browser tabs suspend elapsed time. No controls or audio are created.
The default renderer reserves the tallest sentence's space and supplies the
complete text to screen readers. Reduced motion shows all text without animation.

For lists, mark descriptions with `data-text-show`, call `textShow.mount(root)`
after insertion and `textShow.unmount(root)` before replacement. `textShow.get`
retrieves an element's instance. `textShow.split`, `.words` and `.duration` expose
the shared segmentation, escaped word markup and timing policy to adapters.

ScriptaHub uses the same engine for the home introduction, featured book,
book-page descriptions, keyword/search cards and AI Librarian cards. Its featured-book rotation checks
`completed` and visibility, retaining hover/focus protection.

`book-view.js` is the ScriptaHub adapter. Its `model`, `markup`, `render` and
`page` methods provide all book views; `mount` and `unmount` manage the common
presentation lifecycle. It observes inserted/removed descriptions and loading
gates, so feature, search, Librarian, workflow and book-page code do not implement
separate textShow activation rules.

Book-view playback defaults to `loop: true` for the `page` variant and `false`
for featured/results/context variants. Pass `{loop: true}` or `{loop: false}` to
`ScriptaBookView.render`/`markup` to override it. The rendered description carries
`data-text-show-loop`, which the common lifecycle passes to `textShow`.

External narration adapters can use `pause({freezeAnimation: false})` to suspend
automatic sentence advance while allowing word rendering to finish. Ordinary
`pause()` freezes both timing and word animations.
