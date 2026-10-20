import { DESIGN_BACKGROUND_COLOURS } from './design-presentation';

export function DesignBackgroundSwatches({ disabled = false, onChange, selectedColor }: { disabled?: boolean; onChange: (color: string) => void; selectedColor?: string }) {
  return (
    <div aria-label="Quick background colours" className="custom-design-background-swatches" role="group">
      {DESIGN_BACKGROUND_COLOURS.map(([label, color]) => (
        <button
          aria-label={`Use ${label.toLowerCase()} background`}
          aria-pressed={selectedColor?.toUpperCase() === color}
          disabled={disabled}
          key={color}
          type="button"
          onClick={() => onChange(color)}
        >
          <span aria-hidden="true" className="custom-design-background-swatch" style={{ backgroundColor: color }} />
          {label}
        </button>
      ))}
    </div>
  );
}
