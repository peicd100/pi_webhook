import { Input, CURSOR_MARKER, truncateToWidth } from '@earendil-works/pi-tui';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

// Never call Input.render(): it would draw the secret. No history or model entry.
export async function maskedInput(ctx: ExtensionContext, title: string): Promise<string | undefined> {
  return ctx.ui.custom<string | undefined>((tui, _theme, _keys, done) => {
    let input: Input | undefined = new Input();
    let finished = false;
    const finish = (value: string | undefined) => {
      if (finished) return;
      finished = true;
      input?.setValue(''); input = undefined;
      done(value);
    };
    input.onSubmit = value => finish(value);
    input.onEscape = () => finish(undefined);
    return {
      get focused() { return input?.focused ?? false; },
      set focused(value: boolean) { if(input)input.focused=value; },
      handleInput(data: string) { input?.handleInput(data); tui.requestRender(); },
      invalidate() { input?.invalidate(); },
      render(width: number) {
        const masked = '*'.repeat(Math.min(Array.from(input?.getValue() ?? '').length, Math.max(0,width-2)));
        return [truncateToWidth(title,width), `>${masked}${input?.focused ? CURSOR_MARKER : ''}`,
          truncateToWidth('Enter：確認 · Escape：取消 · 輸入已遮蔽且不會送給模型',width)];
      },
      dispose() { input?.setValue(''); input=undefined; },
    };
  });
}
