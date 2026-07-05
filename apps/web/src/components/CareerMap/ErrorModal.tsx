'use client';

import Modal from '../Modal';

interface Props {
  open:    boolean;
  onClose: () => void;
  /** Optional override — defaults to the verbatim reference-site copy. */
  message?: string;
}

/**
 * Generic data-drift error modal.
 * Wording matches the reference site verbatim. Used by Phase J10 when a
 * shared ?path= URL contains role IDs that no longer exist in the taxonomy.
 */
export default function ErrorModal({
  open, onClose,
  message = 'The map has changed and one or more of your saved jobs is no longer available. Please rebuild your career map.',
}: Props) {
  return (
    <Modal open={open} onClose={onClose} maxWidth="540px" ariaLabel="Notice">
      <p className="text-base text-gray-900 text-center leading-relaxed py-2">
        {message}
      </p>
    </Modal>
  );
}
