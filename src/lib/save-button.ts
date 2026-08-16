/**
 * Wires every save button on the page. Runs in the browser only.
 *
 * The change is applied optimistically and rolled back if the request fails:
 * saving is small and reversible, and a bookmark that waits on a round trip to
 * fill in reads as broken. The server's count then replaces the guess, because
 * other people may have saved the list since the page was rendered.
 */

const FILLED = ['text-emerald-700', 'hover:bg-emerald-50'];
const EMPTY = ['text-stone-400', 'hover:bg-stone-100', 'hover:text-stone-600'];

export function wireSaveButtons(root: ParentNode = document) {
  const buttons = root.querySelectorAll<HTMLButtonElement>('[data-save-list]');

  for (const button of buttons) {
    const listId = button.dataset.saveList!;
    const icon = button.querySelector('svg');
    const label = button.querySelector<HTMLElement>('[data-save-label]');
    const counter = document.querySelector<HTMLElement>(
      `[data-save-count="${listId}"]`,
    );
    const countValue = counter?.querySelector<HTMLElement>(
      '[data-save-count-value]',
    );

    const paint = (saved: boolean, count: number) => {
      button.setAttribute('aria-pressed', String(saved));
      button.setAttribute(
        'aria-label',
        saved ? 'Unsave this list' : 'Save this list',
      );
      icon?.setAttribute('fill', saved ? 'currentColor' : 'none');
      if (label) label.textContent = saved ? 'Saved' : 'Save';

      button.classList.remove(...FILLED, ...EMPTY);
      button.classList.add(...(saved ? FILLED : EMPTY));

      if (countValue) countValue.textContent = String(count);
      counter?.setAttribute(
        'title',
        `Saved by ${count} ${count === 1 ? 'person' : 'people'}`,
      );
    };

    button.addEventListener('click', async (event) => {
      // The card is one big link, and this button sits on top of it.
      event.preventDefault();
      event.stopPropagation();

      const wasSaved = button.getAttribute('aria-pressed') === 'true';
      const previousCount = Number(countValue?.textContent ?? 0);
      const saved = !wasSaved;

      paint(saved, previousCount + (saved ? 1 : -1));
      button.disabled = true;

      try {
        const response = await fetch(`/api/packing-lists/${listId}/save`, {
          method: saved ? 'POST' : 'DELETE',
        });

        if (!response.ok) throw new Error('Request failed');

        const payload = (await response.json()) as {
          saved: boolean;
          count: number;
        };
        paint(payload.saved, payload.count);
      } catch {
        paint(wasSaved, previousCount);
      } finally {
        button.disabled = false;
      }
    });
  }
}
