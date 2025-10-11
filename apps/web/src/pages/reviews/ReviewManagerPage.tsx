import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, toApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type ReviewItem = {
  id: string;
  rating: number;
  body?: string | null;
  createdAt: string;
  author?: { id: string };
};

type ReviewsResponse = {
  items: ReviewItem[];
  hasMore: boolean;
  nextCursor?: string;
};

type UpdateDraft = {
  rating: number;
  body: string;
};

export function ReviewManagerPage() {
  const queryClient = useQueryClient();
  const [propertyInput, setPropertyInput] = useState('');
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const [createBookingId, setCreateBookingId] = useState('');
  const [createRating, setCreateRating] = useState(5);
  const [createBody, setCreateBody] = useState('');
  const [createIdem, setCreateIdem] = useState('');

  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCursor(undefined);
  }, [propertyId]);

  const reviewsQuery = useQuery<ReviewsResponse>({
    queryKey: ['reviews', propertyId, cursor],
    enabled: Boolean(propertyId),
    queryFn: async () => {
      const { data } = await api.get<ReviewsResponse>('/reviews', {
        params: {
          propertyId,
          cursor,
          limit: 10,
        },
      });
      return data;
    },
  });

  const items = reviewsQuery.data?.items ?? [];
  const nextCursor = reviewsQuery.data?.nextCursor;
  const hasMore = reviewsQuery.data?.hasMore ?? false;

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!createBookingId) {
        throw new Error('Booking ID is required');
      }
      const payload = {
        bookingId: createBookingId,
        rating: Number(createRating),
        body: createBody.trim() ? createBody : undefined,
      };
      await api.post('/reviews', payload, {
        headers: createIdem
          ? {
              'Idempotency-Key': createIdem,
            }
          : undefined,
      });
    },
    onSuccess: () => {
      setFeedback('Review submitted successfully.');
      setError(null);
      setCreateBody('');
      setCreateBookingId('');
      setCreateIdem('');
      setCreateRating(5);
      if (propertyId) {
        queryClient.invalidateQueries({ queryKey: ['reviews', propertyId] });
      }
    },
    onError: (err) => {
      setFeedback(null);
      setError(toApiError(err).message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/reviews/${id}`);
    },
    onSuccess: () => {
      if (propertyId) {
        queryClient.invalidateQueries({ queryKey: ['reviews', propertyId] });
      }
    },
    onError: (err) => {
      setError(toApiError(err).message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: UpdateDraft }) => {
      await api.patch(`/reviews/${id}`, {
        rating: draft.rating,
        body: draft.body,
      });
    },
    onSuccess: () => {
      setError(null);
      if (propertyId) {
        queryClient.invalidateQueries({ queryKey: ['reviews', propertyId] });
      }
    },
    onError: (err) => {
      setError(toApiError(err).message);
    },
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, UpdateDraft>>({});

  const startEdit = (review: ReviewItem) => {
    setEditingId(review.id);
    setDrafts((prev) => ({
      ...prev,
      [review.id]: {
        rating: review.rating,
        body: review.body ?? '',
      },
    }));
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const submitEdit = (id: string) => {
    const draft = drafts[id];
    if (!draft) return;
    updateMutation.mutate({ id, draft });
    setEditingId(null);
  };

  const handlePropertySearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = propertyInput.trim();
    setPropertyId(trimmed || null);
    setCursor(undefined);
  };

  const goToNextPage = () => {
    if (hasMore && nextCursor) {
      setCursor(nextCursor);
    }
  };

  const goBackToStart = () => {
    setCursor(undefined);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Reviews</h1>
        <p className="text-sm text-muted-foreground">
          Submit new reviews for completed stays, browse existing feedback by property, and manage your own entries.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Submit a review</CardTitle>
          <CardDescription>
            Provide the booking you completed, rate the stay, and optionally add written feedback.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              createMutation.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="bookingId">Booking ID</Label>
              <Input
                id="bookingId"
                required
                value={createBookingId}
                onChange={(event) => setCreateBookingId(event.target.value)}
                placeholder="bk_123"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rating">Rating (1-5)</Label>
              <Input
                id="rating"
                type="number"
                min={1}
                max={5}
                value={createRating}
                onChange={(event) => setCreateRating(Number(event.target.value))}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="body">Comments (optional)</Label>
              <Textarea
                id="body"
                rows={4}
                value={createBody}
                onChange={(event) => setCreateBody(event.target.value)}
                placeholder="Share your experience with future guests"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="idem">Idempotency key (optional)</Label>
              <Input
                id="idem"
                value={createIdem}
                onChange={(event) => setCreateIdem(event.target.value)}
                placeholder="Use to safely retry a submission"
              />
            </div>
            {feedback ? (
              <p className="md:col-span-2 text-sm text-emerald-600">{feedback}</p>
            ) : null}
            {error ? (
              <p className="md:col-span-2 text-sm text-destructive">{error}</p>
            ) : null}
            <div className="md:col-span-2">
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Submitting…' : 'Submit review'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Browse reviews by property</CardTitle>
          <CardDescription>
            Enter a property ID to load the latest reviews. Only active reviews are returned.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="flex flex-col gap-3 md:flex-row" onSubmit={handlePropertySearch}>
            <div className="flex-1 space-y-2">
              <Label htmlFor="propertySearch">Property ID</Label>
              <Input
                id="propertySearch"
                value={propertyInput}
                onChange={(event) => setPropertyInput(event.target.value)}
                placeholder="prop_123"
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" variant="secondary">
                Load reviews
              </Button>
            </div>
          </form>

          {propertyId ? (
            <div className="space-y-4">
              {reviewsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading reviews…</p>
              ) : items.length ? (
                <div className="space-y-3">
                  {items.map((review) => {
                    const isEditing = editingId === review.id;
                    const draft = drafts[review.id];
                    return (
                      <div
                        key={review.id}
                        className="rounded-lg border border-border p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-sm text-muted-foreground">
                              Review ID: <span className="font-mono">{review.id}</span>
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Created {new Date(review.createdAt).toLocaleString()}
                            </p>
                            {review.author ? (
                              <p className="text-xs text-muted-foreground">
                                Author: <span className="font-mono">{review.author.id}</span>
                              </p>
                            ) : null}
                          </div>
                          <div className="flex gap-2">
                            {isEditing ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => submitEdit(review.id)}
                                  disabled={updateMutation.isPending}
                                >
                                  Save
                                </Button>
                                <Button size="sm" variant="ghost" onClick={cancelEdit}>
                                  Cancel
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button size="sm" variant="outline" onClick={() => startEdit(review)}>
                                  Edit
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => deleteMutation.mutate(review.id)}
                                >
                                  Delete
                                </Button>
                              </>
                            )}
                          </div>
                        </div>

                        {isEditing ? (
                          <div className="mt-4 space-y-3">
                            <div className="space-y-1">
                              <Label htmlFor={`rating-${review.id}`}>Rating</Label>
                              <Input
                                id={`rating-${review.id}`}
                                type="number"
                                min={1}
                                max={5}
                                value={draft?.rating ?? review.rating}
                                onChange={(event) =>
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [review.id]: {
                                      rating: Number(event.target.value),
                                      body: prev[review.id]?.body ?? review.body ?? '',
                                    },
                                  }))
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor={`body-${review.id}`}>Comment</Label>
                              <Textarea
                                id={`body-${review.id}`}
                                rows={4}
                                value={draft?.body ?? review.body ?? ''}
                                onChange={(event) =>
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [review.id]: {
                                      rating: prev[review.id]?.rating ?? review.rating,
                                      body: event.target.value,
                                    },
                                  }))
                                }
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="mt-3 space-y-1 text-sm">
                            <p>Rating: <span className="font-semibold">{review.rating}/5</span></p>
                            {review.body ? (
                              <p className="text-muted-foreground">{review.body}</p>
                            ) : (
                              <p className="text-muted-foreground italic">No comment provided.</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <div className="flex items-center justify-between">
                    <Button variant="ghost" onClick={goBackToStart} disabled={!cursor || reviewsQuery.isFetching}>
                      Back to first page
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={goToNextPage}
                      disabled={!hasMore || !nextCursor || reviewsQuery.isFetching}
                    >
                      Load more
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No reviews found for this property.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Enter a property ID to inspect reviews.
            </p>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
