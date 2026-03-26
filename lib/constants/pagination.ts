export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

export const DEFAULT_PAGE_SIZE: PageSizeOption = PAGE_SIZE_OPTIONS[0];

export function isPageSizeOption(value: number): value is PageSizeOption {
  return PAGE_SIZE_OPTIONS.includes(value as PageSizeOption);
}
