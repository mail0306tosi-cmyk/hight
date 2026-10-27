// 既存の機能回帰テスト用。対象の画面へ実際のナビボタンで移動してから操作する。
// hidden属性・認証ゲートは変更しない。画面分離自体はredesign-ui.cjsで別途検証。
exports.withScreens = function withScreens(page) {
  const wrap = locator => new Proxy(locator, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== 'function') return value;
      if (['click','fill','check','uncheck','innerText','waitFor','isVisible','isEnabled','isDisabled','isChecked'].includes(key)) return async (...args) => {
        const screen = await target.evaluate(el => el.closest('[data-screen]')?.dataset.screen || null);
        if (screen) await page.locator(`[data-nav="${screen}"]`).click();
        return value.apply(target, args);
      };
      return (...args) => {
        const result = value.apply(target, args);
        return result && typeof result.elementHandle === 'function' ? wrap(result) : result;
      };
    }
  });
  return new Proxy(page, { get(target, key) {
    if (key === 'locator') return (...args) => wrap(target.locator(...args));
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
};
