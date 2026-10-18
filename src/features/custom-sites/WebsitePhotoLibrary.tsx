'use client';

import { useRef, useState } from 'react';

export type DesignAsset = { id: string; name: string; role: string; mimeType: string };
export function WebsitePhotoLibrary({ assets, selected, displayed, endpoint, disabled, onSelect, onUpload, onEdit }: {
  assets: DesignAsset[];
  selected: string[];
  displayed: string[];
  endpoint: string;
  disabled: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onUpload: (files: File[], role: 'photo' | 'logo', replaceId?: string) => Promise<void>;
  onEdit: (id: string, replacementId: string | null) => Promise<void>;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const replacement = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState<'photo' | 'logo'>('photo');
  const [replaceId, setReplaceId] = useState<string>();
  const [rights, setRights] = useState(false);
  return (
    <section className="studio-photo-library" aria-labelledby="website-photos-title">
      <span className="setup-eyebrow">MAKE IT YOURS</span>
      <h3 id="website-photos-title">Your photos & logo</h3>
      <p>Add pictures of your work, your salon and your logo. Luster uses only the images you choose for this business.</p>
      <label className="studio-rights">
        <input type="checkbox" checked={rights} onChange={event => setRights(event.target.checked)} />
        {' '}
        I own or have permission to use the photos and logo I upload.
      </label>
      <div className="studio-photo-actions">
        <button
          type="button"
          disabled={disabled || !rights}
          onClick={() => {
            setRole('photo');
            if (picker.current) {
              picker.current.multiple = true;
            }
            picker.current?.click();
          }}
        >
          Add photos
        </button>
        <button
          type="button"
          disabled={disabled || !rights}
          onClick={() => {
            setRole('logo');
            if (picker.current) {
              picker.current.multiple = false;
            }
            picker.current?.click();
          }}
        >
          Add logo
        </button>
      </div>
      <input
        ref={picker}
        type="file"
        aria-label="Choose website photos or logo"
        accept="image/png,image/jpeg,image/webp"
        multiple={role === 'photo'}
        hidden
        style={{ display: 'none' }}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length && rights) {
            void onUpload(files, role);
          }
        }}
      />
      <input
        ref={replacement}
        type="file"
        aria-label="Choose replacement photo"
        accept="image/png,image/jpeg,image/webp"
        hidden
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          const asset = assets.find(item => item.id === replaceId);
          if (file && asset && rights) {
            void onUpload([file], asset.role === 'logo' ? 'logo' : 'photo', asset.id);
          }
        }}
      />
      <p className="studio-hint">Up to six photos and logos per design · PNG, JPG or WebP · 20 MB each. Larger images are prepared automatically without stretching or cropping. Transparent logos keep their background clear. No photos yet? You can still create a design without them.</p>
      {assets.length > 0 && (
        <div className="studio-photo-grid">
          {assets.map(asset => (
            <article key={asset.id} className="studio-photo-card">
              {/* Private tenant-authorized endpoint, not an arbitrary external URL. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${endpoint}&asset=${asset.id}`} alt={asset.name} />
              <strong>{asset.name}</strong>
              <span>
                {asset.role === 'logo' ? 'Logo' : 'Website photo'}
                {displayed.includes(asset.id) ? ' · In this draft' : ''}
              </span>
              <label>
                <input type="checkbox" checked={selected.includes(asset.id)} disabled={disabled || (!selected.includes(asset.id) && selected.length >= 6)} onChange={event => onSelect(asset.id, event.target.checked)} />
                {' '}
                Use in my next design
              </label>
              {displayed.includes(asset.id) && (
                <div className="studio-photo-actions">
                  <button
                    type="button"
                    disabled={disabled || !rights}
                    onClick={() => {
                      setReplaceId(asset.id);
                      replacement.current?.click();
                    }}
                  >
                    Replace photo
                  </button>
                  <button type="button" disabled={disabled} onClick={() => void onEdit(asset.id, null)}>Remove from draft</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      <p className="studio-hint">Replacing or removing a photo changes your draft. Your published site and earlier design versions keep their photos until you approve a change.</p>
    </section>
  );
}
