import { CANONICAL_SERVICES } from '../../booking/data';
import { formatPrice } from '../../booking/helpers';
import type { FeaturedServicesSettings } from '../../model/section-library/settings';
import { ChoiceField } from './fields';
import type { LibrarySectionEditorProps } from './types';

/** The registry clamps `serviceIds` to six; the customer renderer shows six. */
const MAX_FEATURED_SERVICES = 6;

const resolveServices = (
  ids: readonly string[],
): (typeof CANONICAL_SERVICES)[number][] => ids
  .map(id => CANONICAL_SERVICES.find(service => service.id === id))
  .filter((service): service is (typeof CANONICAL_SERVICES)[number] => Boolean(service));

/**
 * Featured Services binds the canonical catalogue by id — it never copies a
 * service. `featured` follows the menu's own featured flags (read-only here);
 * `manual` is the owner's deliberate, ordered pick from their live menu.
 */
export function FeaturedServicesEditor({
  context,
  onChange,
  settings,
}: LibrarySectionEditorProps<'featured_services'>) {
  const menuServices = resolveServices(context.canonicalServiceIds);
  const featuredServices = resolveServices(context.featuredServiceIds);
  const atCap = settings.serviceIds.length >= MAX_FEATURED_SERVICES;
  const staleCount = settings.serviceIds.filter(
    id => !context.canonicalServiceIds.includes(id),
  ).length;

  const toggleService = (serviceId: string, included: boolean) => {
    const serviceIds = included
      ? [...settings.serviceIds, serviceId].slice(0, MAX_FEATURED_SERVICES)
      : settings.serviceIds.filter(id => id !== serviceId);
    onChange({ ...settings, serviceIds } satisfies FeaturedServicesSettings);
  };

  /** Picks whose service left the menu render nothing and still hold a slot. */
  const dropMissingServices = () => {
    onChange({
      ...settings,
      serviceIds: settings.serviceIds.filter(
        id => context.canonicalServiceIds.includes(id),
      ),
    } satisfies FeaturedServicesSettings);
  };

  return (
    <>
      <ChoiceField
        hint="Luster picks follow the featured services on your menu. Choosing your own keeps exactly the services you tick."
        label="Which services"
        onChange={source => onChange({ ...settings, source } satisfies FeaturedServicesSettings)}
        options={[
          { label: 'Luster picks (featured services)', value: 'featured' },
          { label: 'I choose', value: 'manual' },
        ]}
        value={settings.source}
      />
      {settings.source === 'manual' ? (
        <div className="form-field">
          <span>Services to feature</span>
          {menuServices.length === 0 ? (
            <small className="form-hint">
              Your service menu is empty, so there is nothing to feature yet.
            </small>
          ) : (
            <>
              <small className="form-hint">
                Up to {MAX_FEATURED_SERVICES}, shown in the order you tick them.
                {' '}
                {settings.serviceIds.length} of {MAX_FEATURED_SERVICES} chosen.
              </small>
              {staleCount > 0 ? (
                <button
                  className="secondary-button"
                  onClick={dropMissingServices}
                  type="button"
                >
                  Remove {staleCount} service{staleCount === 1 ? '' : 's'} that left your menu
                </button>
              ) : null}
              <div className="editor-record-list">
                {menuServices.map((service) => {
                  const included = settings.serviceIds.includes(service.id);
                  return (
                    <label className="form-field form-field--toggle" key={service.id}>
                      <input
                        checked={included}
                        disabled={!included && atCap}
                        onChange={event => toggleService(service.id, event.target.checked)}
                        type="checkbox"
                      />
                      <span>{service.name}</span>
                      <small className="form-hint">{formatPrice(service.price)}</small>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="form-field">
          <span>Luster picks right now</span>
          {featuredServices.length === 0 ? (
            <small className="form-hint">
              None of the services on your menu are marked as featured, so this
              section stays off your site until you choose services yourself.
            </small>
          ) : (
            <>
              <ul className="editor-record-list">
                {featuredServices.slice(0, MAX_FEATURED_SERVICES).map(service => (
                  <li key={service.id}>
                    {service.name} · {formatPrice(service.price)}
                  </li>
                ))}
              </ul>
              <small className="form-hint">
                This list follows your menu — it changes on its own when your
                featured services change.
                {featuredServices.length > MAX_FEATURED_SERVICES
                  ? ` Only the first ${MAX_FEATURED_SERVICES} appear on your site.`
                  : ''}
              </small>
            </>
          )}
        </div>
      )}
    </>
  );
}
