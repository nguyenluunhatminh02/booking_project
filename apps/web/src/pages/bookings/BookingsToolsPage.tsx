import { FormEvent, useState, ChangeEvent } from 'react';
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

export function BookingsToolsPage() {
  const [seedHost, setSeedHost] = useState('u1');
  const [seedFrom, setSeedFrom] = useState('2025-12-01');
  const [seedNights, setSeedNights] = useState('7');
  const [seedPrice, setSeedPrice] = useState('1000000');
  const [seedRemaining, setSeedRemaining] = useState('2');
  const [seedTitle, setSeedTitle] = useState('Dev Property');
  const [seedResult, setSeedResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [forceBookingId, setForceBookingId] = useState('');
  const [forceStatus, setForceStatus] = useState('HOLD');
  const [forceHoldExpiresAt, setForceHoldExpiresAt] = useState('');
  const [forceResult, setForceResult] = useState<any | null>(null);

  const [previewBookingId, setPreviewBookingId] = useState('');
  const [previewCancelAt, setPreviewCancelAt] = useState('');
  const [previewResult, setPreviewResult] = useState<any | null>(null);

  const [expireResult, setExpireResult] = useState<any | null>(null);

  const [cancelPaidBookingId, setCancelPaidBookingId] = useState('');
  const [cancelPaidResult, setCancelPaidResult] = useState<any | null>(null);

  const submitSeed = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const { data } = await api.post('/bookings/dev/seed-basic', {
        hostId: seedHost,
        from: seedFrom,
        nights: seedNights,
        price: seedPrice,
        remaining: seedRemaining,
        title: seedTitle,
      });
      setSeedResult(data);
    } catch (err) {
      setError(toApiError(err).message);
      setSeedResult(null);
    }
  };

  const doForce = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const body: any = { status: forceStatus };
      if (forceHoldExpiresAt)
        body.holdExpiresAt = new Date(forceHoldExpiresAt).toISOString();
      const { data } = await api.post(
        `/bookings/dev/force-status/${forceBookingId}`,
        body,
      );
      setForceResult(data);
    } catch (err) {
      setError(toApiError(err).message);
      setForceResult(null);
    }
  };

  const doPreview = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const params = previewCancelAt
        ? `?cancelAt=${encodeURIComponent(new Date(previewCancelAt).toISOString())}`
        : '';
      const { data } = await api.get(
        `/bookings/${previewBookingId}/preview-refund${params}`,
      );
      setPreviewResult(data);
    } catch (err) {
      setError(toApiError(err).message);
      setPreviewResult(null);
    }
  };

  const doExpire = async () => {
    setError(null);
    try {
      const { data } = await api.post('/bookings/expire-holds');
      setExpireResult(data);
    } catch (err) {
      setError(toApiError(err).message);
      setExpireResult(null);
    }
  };

  const doCancelPaid = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const { data } = await api.post(
        `/bookings/${cancelPaidBookingId}/cancel-paid-or-confirmed`,
        {
          userId: 'host',
        },
      );
      setCancelPaidResult(data);
    } catch (err) {
      setError(toApiError(err).message);
      setCancelPaidResult(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Booking tools (dev/admin)</h1>
        <p className="text-sm text-muted-foreground">
          Utilities to exercise booking-related backend endpoints for
          development/testing.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Seed basic property + availability</CardTitle>
          <CardDescription>
            Quickly create a property with consecutive availability days for
            local testing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-3" onSubmit={submitSeed}>
            <div className="space-y-2">
              <Label>Host ID</Label>
              <Input
                value={seedHost}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setSeedHost(e.target.value)
                }
              />
            </div>
            <div className="space-y-2">
              <Label>From</Label>
              <Input
                type="date"
                value={seedFrom}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setSeedFrom(e.target.value)
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Nights</Label>
              <Input
                value={seedNights}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setSeedNights(e.target.value)
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Price</Label>
              <Input
                value={seedPrice}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setSeedPrice(e.target.value)
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Remaining</Label>
              <Input
                value={seedRemaining}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setSeedRemaining(e.target.value)
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Title (optional)</Label>
              <Input
                value={seedTitle}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setSeedTitle(e.target.value)
                }
              />
            </div>
            <div className="md:col-span-3">
              <Button type="submit">Create demo property</Button>
            </div>
          </form>
          {seedResult ? (
            <pre className="mt-3 whitespace-pre-wrap text-sm">
              {JSON.stringify(seedResult, null, 2)}
            </pre>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Expire holds</CardTitle>
          <CardDescription>
            Run a sweep to expire HOLD/REVIEW bookings and return inventory.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Button onClick={doExpire}>Expire holds now</Button>
            {expireResult ? (
              <div className="text-sm">
                Result: {JSON.stringify(expireResult)}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Force status / preview refund</CardTitle>
          <CardDescription>
            Force a booking status (dev) or preview refund amount for a booking.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-3" onSubmit={doForce}>
            <div className="space-y-2">
              <Label>Booking ID</Label>
              <Input
                value={forceBookingId}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setForceBookingId(e.target.value)
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <select
                value={forceStatus}
                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                  setForceStatus(e.target.value)
                }
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option>HOLD</option>
                <option>REVIEW</option>
                <option>CONFIRMED</option>
                <option>PAID</option>
                <option>REFUNDED</option>
                <option>CANCELLED</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>holdExpiresAt (optional)</Label>
              <Input
                type="datetime-local"
                value={forceHoldExpiresAt}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setForceHoldExpiresAt(e.target.value)
                }
              />
            </div>
            <div className="md:col-span-3">
              <Button type="submit">Force status</Button>
              {forceResult ? (
                <pre className="mt-3 whitespace-pre-wrap text-sm">
                  {JSON.stringify(forceResult, null, 2)}
                </pre>
              ) : null}
            </div>
          </form>

          <hr className="my-4" />

          <form className="grid gap-3 md:grid-cols-3" onSubmit={doPreview}>
            <div className="space-y-2">
              <Label>Booking ID</Label>
              <Input
                value={previewBookingId}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setPreviewBookingId(e.target.value)
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Cancel at (optional)</Label>
              <Input
                type="date"
                value={previewCancelAt}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setPreviewCancelAt(e.target.value)
                }
              />
            </div>
            <div className="md:col-span-3">
              <Button type="submit">Preview refund</Button>
              {previewResult ? (
                <pre className="mt-3 whitespace-pre-wrap text-sm">
                  {JSON.stringify(previewResult, null, 2)}
                </pre>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cancel PAID/CONFIRMED</CardTitle>
          <CardDescription>
            Trigger the cancelPaidOrConfirmed flow (mock refund + inventory
            return).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-3" onSubmit={doCancelPaid}>
            <div className="space-y-2">
              <Label>Booking ID</Label>
              <Input
                value={cancelPaidBookingId}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setCancelPaidBookingId(e.target.value)
                }
              />
            </div>
            <div className="md:col-span-3">
              <Button type="submit">Cancel PAID/CONFIRMED</Button>
              {cancelPaidResult ? (
                <pre className="mt-3 whitespace-pre-wrap text-sm">
                  {JSON.stringify(cancelPaidResult, null, 2)}
                </pre>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
