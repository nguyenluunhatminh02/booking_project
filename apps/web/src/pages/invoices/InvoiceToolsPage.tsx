import { useState } from 'react';
import { api, API_BASE_URL, toApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function InvoiceToolsPage() {
  const [bookingId, setBookingId] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const openInvoice = (download: boolean) => {
    if (!bookingId) {
      setError('Booking ID is required.');
      return;
    }
    const query = download ? '?download=1' : '';
    const url = `${API_BASE_URL}/v1/invoices/${bookingId}.pdf${query}`;
    window.open(url, '_blank', 'noopener');
    setStatus('Invoice opened in a new tab.');
    setError(null);
  };

  const sendEmail = async () => {
    if (!bookingId) {
      setError('Booking ID is required.');
      return;
    }
    setIsSending(true);
    setStatus(null);
    setError(null);
    try {
      await api.post(`/v1/invoices/${bookingId}/email`);
      setStatus('Invoice email has been queued for delivery.');
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <p className="text-sm text-muted-foreground">
          Download booking invoices as PDF documents or trigger customer delivery via email.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invoice actions</CardTitle>
          <CardDescription>
            Enter a booking identifier to generate the PDF or send it directly to the guest’s inbox.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Input
              value={bookingId}
              onChange={(event) => setBookingId(event.target.value)}
              placeholder="Booking ID (e.g. bk_123)"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => openInvoice(false)}>
              View PDF
            </Button>
            <Button variant="secondary" onClick={() => openInvoice(true)}>
              Download PDF
            </Button>
            <Button onClick={sendEmail} disabled={isSending}>
              {isSending ? 'Sending…' : 'Email invoice'}
            </Button>
          </div>
          {status ? (
            <p className="text-sm text-emerald-600">{status}</p>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
