# Auto-Advance Timer：`_autoAdvanceTimer` 的雙重語意

## 問題描述

`BaseModule._autoAdvanceTimer` 在不同地方被賦予兩種不同型別的值：

```javascript
// 情況 A：設為 true（布林值），表示「即將推進，但不需要清除」
this._autoAdvanceTimer = true;  // BaseModule.js:573

// 情況 B：設為 setTimeout 物件，需要在手動推進時 clearTimeout
this._autoAdvanceTimer = setTimeout(() => {
    this._autoAdvanceTimer = null;
    ...
}, delay);
```

清除時的判斷：

```javascript
if (typeof this._autoAdvanceTimer === 'object') {
    clearTimeout(this._autoAdvanceTimer);  // 只清 setTimeout，不清 true
}
this._autoAdvanceTimer = null;
```

## 為什麼這樣設計（intentional）

情況 A 出現在「所有玩家已確認，自動推進」的流程中。這個推進是**立即觸發、同步執行**的（透過 `await this.onHostNextStage()`），不需要計時器也不需要取消。

設為 `true` 的目的是：**作為 guard flag**，防止重複觸發（`if (!this._autoAdvanceTimer)` 的條件判斷）。

## 潛在風險

1. `typeof === 'object'` 的 `null` 陷阱：`typeof null === 'object'` 在 JS 是 true，但因為進入此分支前已確認非 null，目前不會出錯。

2. 若未來有人在情況 A 的路徑後又呼叫清除邏輯，`clearTimeout(true)` 是 no-op（安全），但旗標會被清為 null，可能導致重複推進。

## 建議的後續重構（待評估）

將 guard flag 和實際 timer 拆成兩個變數：

```javascript
this._autoAdvancePending = false;   // boolean guard
this._autoAdvanceTimer   = null;    // setTimeout handle only
```

這樣語意清晰，clearTimeout 永遠只針對 timer 物件，不需要 typeof 判斷。

**注意**：重構前需確認所有使用 `_autoAdvanceTimer` 的分支（約 8 處）都一起修改，否則會引入新 bug。
