import { Images } from 'lucide-react';

type YourDesignActionProps = {
  hasDesign: boolean;
  onOpen: () => void;
};

export function YourDesignAction({ hasDesign, onOpen }: YourDesignActionProps) {
  return (
    <button className="secondary-button onboarding-design-entry" type="button" onClick={onOpen}>
      <Images aria-hidden="true" size={18} />
      {hasDesign ? 'Edit your design' : 'Add your design'}
    </button>
  );
}
