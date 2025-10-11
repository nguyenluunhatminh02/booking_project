import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, toApiError } from '@/lib/api';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type PropertyListResponse = {
  items: Array<{
    id: string;
    title: string;
    address: string;
    createdAt: string;
    cover?: { url: string | null } | null;
  }>;
  total: number;
};

const propertiesKey = ['properties'];

export function PropertiesListPage() {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [formState, setFormState] = useState({
    title: '',
    address: '',
    description: '',
  });

  const propertiesQuery = useQuery<PropertyListResponse>({
    queryKey: propertiesKey,
    queryFn: async () => {
      const { data } = await api.get<PropertyListResponse>('/properties');
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async ({
      title,
      address,
      description,
    }: {
      title: string;
      address: string;
      description?: string;
    }) => {
      const { data } = await api.post('/properties', {
        title,
        address,
        description: description?.trim() ? description : undefined,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: propertiesKey });
      setFormState({ title: '', address: '', description: '' });
      setFormError(null);
    },
    onError: (error) => {
      const apiError = toApiError(error);
      setFormError(apiError.message);
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createMutation.mutate(formState);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Properties</h1>
        <p className="text-sm text-muted-foreground">
          Manage inventory and availability for each property connected to your
          account.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add property</CardTitle>
          <CardDescription>
            Provide a title and address. You can enrich data later in the detail
            view.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                required
                value={formState.title}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    title: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                required
                value={formState.address}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    address: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                rows={4}
                value={formState.description}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
              />
            </div>
            {formError ? (
              <p className="md:col-span-2 text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <div className="md:col-span-2">
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Saving...' : 'Create property'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Property list</CardTitle>
          <CardDescription>
            {propertiesQuery.data?.total ?? 0} records found.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {propertiesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : propertiesQuery.data?.items.length ? (
            <div className="grid gap-4 md:grid-cols-2">
              {propertiesQuery.data.items.map((property) => (
                <div
                  key={property.id}
                  className="rounded-lg border border-border p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-semibold">
                        {property.title}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {property.address}
                      </p>
                    </div>
                    <Link
                      className="text-sm text-primary hover:underline"
                      to={`/properties/${property.id}`}
                    >
                      View
                    </Link>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Created at{' '}
                    {new Date(property.createdAt).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No properties yet. Use the form above to create one.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
