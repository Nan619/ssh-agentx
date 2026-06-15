import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme, Theme } from "../../hooks/useTheme";

const options: { value: Theme; icon: typeof Sun; label: string }[] = [
  { value: "dark", icon: Moon, label: "深色" },
  { value: "light", icon: Sun, label: "浅色" },
  { value: "system", icon: Monitor, label: "跟随系统" },
];

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();

  return (
    <div>
      <div style={sectionLabelStyle}>界面主题</div>
      <div style={{ display: "flex", gap: 8 }}>
        {options.map(({ value, icon: Icon, label }) => (
          <button
            key={value}
            onClick={() => setTheme(value)}
            style={{
              ...optionStyle,
              background: theme === value ? "var(--accent-subtle)" : "var(--bg-tertiary)",
              borderColor: theme === value ? "var(--accent)" : "var(--border-color)",
              color: theme === value ? "var(--accent)" : "var(--text-secondary)",
            }}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: "12px",
  fontWeight: 600,
  color: "var(--text-secondary)",
  marginBottom: 10,
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const optionStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 16px",
  border: "1px solid",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: "13px",
  fontWeight: 500,
  transition: "border-color 0.15s, background 0.15s",
};
