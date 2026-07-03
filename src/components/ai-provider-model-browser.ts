export function summarizeModelCatalog(totalModels: number, visibleModels: number): string {
  const loaded = `${totalModels.toLocaleString()} models loaded`;
  if (totalModels === visibleModels) return loaded;
  return `${loaded} - ${visibleModels.toLocaleString()} matching`;
}

export function getVisibleModelTags<T extends string>(
  tags: readonly T[],
  maxVisible = 3,
): { visibleTags: T[]; hiddenTagCount: number } {
  const visibleTags = tags.slice(0, maxVisible);
  return {
    visibleTags,
    hiddenTagCount: Math.max(tags.length - visibleTags.length, 0),
  };
}
