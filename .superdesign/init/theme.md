# Theme source

The complete theme implementation is `src/styles.css` (801 lines) and must be passed to every design command. Core raw tokens:

```css
:root {
  font-family: "Avenir Next", Avenir, "SF Pro Display", system-ui, sans-serif;
  color: #291b25;
  background: #f6f1e9;
  --canvas: #f6f1e9;
  --surface: #fffcf7;
  --surface-muted: #eee6dc;
  --sidebar: #35152e;
  --sidebar-raised: #45203d;
  --primary: #4a1f3f;
  --primary-hover: #35152e;
  --text: #291b25;
  --text-soft: #6e6269;
  --text-muted: #8b7f85;
  --border: #ddd1c5;
  --border-strong: #c8b9ab;
  --champagne: #b59661;
  --champagne-soft: #eee3cf;
  --success: #5f735f;
  --success-soft: #e5ebe2;
  --warning: #9a6837;
  --warning-soft: #f3e7d7;
  --danger: #8b404a;
  --danger-soft: #f4e2e3;
  --info: #5d6e82;
  --info-soft: #e6eaf0;
  --radius-panel: 14px;
  --radius-control: 9px;
  --radius-badge: 7px;
  --shadow: 0 14px 38px rgba(53, 21, 46, 0.08);
}
```

Responsive breakpoints in `src/styles.css`: 1180px, 980px, 760px, and 520px. The product uses restrained motion (160–180ms), compact type, fine borders, ivory surfaces, deep-plum navigation, and champagne only for controlled emphasis.
