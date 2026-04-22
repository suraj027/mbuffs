import { describe, expect, it } from "vitest";
import {
  CATEGORY_FULL_PAGE_ITEMS_PER_PAGE,
  CATEGORY_OVERVIEW_FETCH_LIMIT,
  CATEGORY_PREVIEW_ITEMS_PER_ROW,
  FOR_YOU_FULL_PAGE_ITEMS_PER_PAGE,
  FOR_YOU_PREVIEW_ITEMS_PER_PAGE,
  dedupeRecommendations,
  dedupeForYouRecommendations,
  getPersonalizedGenreRecommendationsPageQueryKey,
  getPersonalizedTheatricalRecommendationsPageQueryKey,
  getForYouRecommendationsPageQueryKey,
  getCategoryRecommendationsOverviewQueryKey,
  getSharedPersonalizedGenreInfiniteQueryOptions,
  getSharedPersonalizedTheatricalInfiniteQueryOptions,
  getSharedForYouInfiniteQueryOptions,
  mergePreviewWithPagedRecommendations,
  selectCategoryPreviewRecommendations,
  selectForYouPreviewRecommendations,
} from "@/lib/recommendationQueries";

type RecommendationStub = {
  id: number;
  title: string;
};

const recommendation = (id: number): RecommendationStub => ({
  id,
  title: `Title ${id}`,
});

describe("for-you query consistency", () => {
  it("uses the same query key as the full page configuration", () => {
    const userId = "test-user";
    const sharedOptions = getSharedForYouInfiniteQueryOptions(userId);

    expect(sharedOptions.queryKey).toEqual(
      getForYouRecommendationsPageQueryKey(userId, FOR_YOU_FULL_PAGE_ITEMS_PER_PAGE)
    );
  });
});

describe("category query consistency", () => {
  it("uses the same query key for the category row and full genre page", () => {
    const userId = "test-user";
    const mediaType = "movie" as const;
    const genreId = 28;
    const sharedOptions = getSharedPersonalizedGenreInfiniteQueryOptions(userId, mediaType, genreId);

    expect(sharedOptions.queryKey).toEqual(
      getPersonalizedGenreRecommendationsPageQueryKey(
        userId,
        mediaType,
        genreId,
        CATEGORY_FULL_PAGE_ITEMS_PER_PAGE,
      )
    );
  });

  it("uses the same query key for the theatrical row and full page", () => {
    const userId = "test-user";
    const sharedOptions = getSharedPersonalizedTheatricalInfiniteQueryOptions(userId);

    expect(sharedOptions.queryKey).toEqual(
      getPersonalizedTheatricalRecommendationsPageQueryKey(
        userId,
        CATEGORY_FULL_PAGE_ITEMS_PER_PAGE,
      )
    );
  });

  it("keys category overview queries by media type and fetch limit", () => {
    expect(
      getCategoryRecommendationsOverviewQueryKey("test-user", "movie", CATEGORY_OVERVIEW_FETCH_LIMIT)
    ).toEqual([
      "recommendations",
      "categories",
      "test-user",
      "overview",
      "movie",
      CATEGORY_OVERVIEW_FETCH_LIMIT,
    ]);
  });
});

describe("for-you preview selection", () => {
  it("deduplicates recommendations while preserving first-seen order", () => {
    const raw = [recommendation(1), recommendation(2), recommendation(1), recommendation(3), recommendation(2)];

    const deduplicated = dedupeForYouRecommendations(raw);

    expect(deduplicated.map((item) => item.id)).toEqual([1, 2, 3]);
  });

  it("keeps home preview aligned with the first items shown on full for-you list", () => {
    const withDuplicates = [
      recommendation(1),
      recommendation(2),
      recommendation(2),
      recommendation(3),
      ...Array.from({ length: 40 }, (_, index) => recommendation(index + 4)),
    ];

    const fullPageResults = dedupeForYouRecommendations(withDuplicates);
    const homePreview = selectForYouPreviewRecommendations(withDuplicates);

    expect(homePreview).toHaveLength(FOR_YOU_PREVIEW_ITEMS_PER_PAGE);
    expect(homePreview).toEqual(fullPageResults.slice(0, FOR_YOU_PREVIEW_ITEMS_PER_PAGE));
  });

  it("returns all available recommendations when below preview limit", () => {
    const fewerThanPreview = [recommendation(7), recommendation(8), recommendation(8)];

    const homePreview = selectForYouPreviewRecommendations(fewerThanPreview);

    expect(homePreview).toEqual([recommendation(7), recommendation(8)]);
  });
});

describe("category preview selection", () => {
  it("keeps category rows aligned with the first items shown on the full genre page", () => {
    const withDuplicates = [
      recommendation(11),
      recommendation(12),
      recommendation(12),
      recommendation(13),
      ...Array.from({ length: 40 }, (_, index) => recommendation(index + 14)),
    ];

    const fullPageResults = dedupeRecommendations(withDuplicates);
    const categoryPreview = selectCategoryPreviewRecommendations(withDuplicates);

    expect(categoryPreview).toHaveLength(CATEGORY_PREVIEW_ITEMS_PER_ROW);
    expect(categoryPreview).toEqual(fullPageResults.slice(0, CATEGORY_PREVIEW_ITEMS_PER_ROW));
  });

  it("keeps cross-category preview items first when paged genre results overlap", () => {
    const previewResults = [recommendation(21), recommendation(22), recommendation(23)];
    const pagedResults = [recommendation(22), recommendation(23), recommendation(24), recommendation(25)];

    const merged = mergePreviewWithPagedRecommendations(previewResults, pagedResults);

    expect(merged).toEqual([
      recommendation(21),
      recommendation(22),
      recommendation(23),
      recommendation(24),
      recommendation(25),
    ]);
  });
});
