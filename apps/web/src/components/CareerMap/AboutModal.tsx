'use client';

import Modal from '../Modal';

interface Props {
  open:         boolean;
  onClose:      () => void;
  industryName: string;
}

/**
 * About this Map / FAQs modal.
 * Matches the Critical Materials reference site's 5-item Q&A format.
 * Industry name is parameterized so the same modal works for all 3 industries.
 */
export default function AboutModal({ open, onClose, industryName }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="About this Map / FAQs" maxWidth="720px">
      <div className="text-sm text-gray-700 leading-relaxed space-y-4">
        <p>
          <strong className="text-gray-900">About the {industryName} Career Map.</strong>{' '}
          The {industryName} Career Map highlights some of the most exciting jobs in the
          industry today. These are jobs which provide a variety of career opportunities.
        </p>

        <p>
          <strong className="text-gray-900">Who is the Career Map for?</strong>{' '}
          The map is for anyone who is interested in the {industryName.toLowerCase()} industry. This
          includes those already working in the industry who want to understand their options
          for career progression and develop the skills to get there. It also includes those
          new to the industry who want to learn more about its various jobs and career paths,
          as well as the skills required to be successful.
        </p>

        <p>
          <strong className="text-gray-900">How were the salaries determined?</strong>{' '}
          The salary ranges for the jobs in this map are based on the U.S. BLS Occupational
          Employment &amp; Wage Statistics, public job-board reviews, and subject-matter expert
          guidance.
        </p>

        <p>
          <strong className="text-gray-900">What if I don&apos;t see my job on the {industryName} Career Map?</strong>{' '}
          As you review the map, it&apos;s possible you don&apos;t see your job listed. That&apos;s because
          the map shows a sample of the industry&apos;s exciting jobs, and unfortunately, we
          couldn&apos;t fit every job in the industry on the map. It&apos;s also possible that your
          job is on the map but might prefer a slightly different name, so click around!
        </p>

        <p>
          <strong className="text-gray-900">How was the Career Map developed?</strong>{' '}
          The {industryName} Career Map was developed using public-domain workforce research,
          BLS occupational frameworks, and industry-body input. Job openings are refreshed
          weekly via an automated ingestion pipeline.
        </p>
      </div>
    </Modal>
  );
}
