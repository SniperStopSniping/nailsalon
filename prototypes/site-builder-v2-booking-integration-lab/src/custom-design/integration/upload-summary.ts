import { CUSTOM_DESIGN_MAX_IMAGES } from '../model/constants';

type UploadFailureLike = {
  code: string;
};

const countPhrase = (
  count: number,
  singular: string,
  plural: string,
): string => `${count} ${count === 1 ? singular : plural}`;

const joinClauses = (clauses: readonly string[]): string => {
  if (clauses.length <= 1) return `${clauses[0] ?? ''}.`;
  if (clauses.length === 2) return `${clauses[0]} and ${clauses[1]}.`;
  return `${clauses.slice(0, -1).join(', ')}, and ${clauses.at(-1)}.`;
};

export const formatCustomDesignUploadSummary = (
  addedCount: number,
  failures: readonly UploadFailureLike[],
): string => {
  const capacityFailureCount = failures.filter(
    failure => failure.code === 'too_many_images',
  ).length;
  const otherFailureCount = failures.length - capacityFailureCount;
  const addedClause = addedCount === 0
    ? 'No images were added'
    : `${countPhrase(addedCount, 'image was', 'images were')} added`;

  if (capacityFailureCount > 0) {
    const clauses = [addedClause];
    clauses.push(
      capacityFailureCount === 1
        ? '1 image was skipped because the section is full'
        : `${capacityFailureCount} were skipped because the section is full`,
    );
    if (otherFailureCount > 0) {
      clauses.push(
        `${countPhrase(otherFailureCount, 'file could', 'files could')} not be processed`,
      );
    }
    return `This section can contain up to ${CUSTOM_DESIGN_MAX_IMAGES} images. ${joinClauses(clauses)}`;
  }

  if (otherFailureCount > 0) {
    return `${addedClause}. ${countPhrase(otherFailureCount, 'file could', 'files could')} not be processed.`;
  }
  return `${addedClause}.`;
};
