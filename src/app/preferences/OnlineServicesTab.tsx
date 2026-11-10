import { useEffect, useState } from 'react';
import { t } from '../../core/i18n';
import { BROWSER_SERVICES, offReason, SERVICE_WORDS, servicesStatus, type ServiceStatus } from '../servicesStatus';

// Settings → Online services (4.0): every online service the app may contact, what for, when, which server, and what
// the service switch says now (On; Turned off, with why; or Not checked yet, before the switch file has been read).
// Built from the registry in src-tauri/src/services.rs. Opening this tab never makes the app read the switch file.

function stateWords(service: ServiceStatus): string {
  if (service.state === 'unchecked') return t('services.state.unchecked');
  return t(service.state === 'on' ? 'services.state.on' : 'services.state.off');
}

export function OnlineServicesView({ services }: { services: readonly ServiceStatus[] }) {
  return (
    <div className="flex max-w-[560px] flex-col gap-3 p-4">
      <p className="text-[12px] text-text-muted">{t('services.intro')}</p>
      <ul aria-label={t('services.list')} className="flex flex-col border border-border">
        {services.map((service) => {
          // A service added in Rust without words yet is still listed, with its id and server, never hidden.
          const words = SERVICE_WORDS[service.id];
          return (
            <li key={service.id} className="flex flex-col gap-1 border-b border-border p-3 last:border-b-0" data-service={service.id}>
              <h3 className="text-[14px] font-bold">
                {words ? t(words.name) : t('services.unknown.name')}
                {!words && <span className="ml-2 font-mono text-[12px] font-normal">{service.id}</span>}
              </h3>
              {words && (
                <>
                  <p className="text-[13px]">{t(words.purpose)}</p>
                  <p className="text-[13px]">
                    <span className="sb-label mr-1">{t('services.when')}</span>
                    {t(words.when)}
                  </p>
                </>
              )}
              <p className="text-[13px]">
                <span className="sb-label mr-1">{t('services.server')}</span>
                <span className="font-mono text-[12px]">{service.server}</span>
              </p>
              <p className="text-[13px]">
                <span className="sb-label mr-1">{t('services.state')}</span>
                <span data-service-state={service.state}>{stateWords(service)}</span>
              </p>
              {service.state === 'off' && <p className="text-[13px]">{offReason(service.reason)}</p>}
            </li>
          );
        })}
      </ul>
      <p className="text-[12px] text-text-muted">{t('services.listNote')}</p>
    </div>
  );
}

export function OnlineServicesTab() {
  const [services, setServices] = useState<readonly ServiceStatus[]>(BROWSER_SERVICES);
  useEffect(() => {
    let current = true;
    servicesStatus().then(
      (found) => {
        if (current) setServices(found);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);
  return <OnlineServicesView services={services} />;
}
