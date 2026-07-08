export interface SubscribeResponse {
  success: boolean;
  message: string;
  data?: unknown;
}

export async function handleNewsletterSignup(email: string): Promise<SubscribeResponse> {
  try {
    const res = await fetch('/api/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return { success: false, message: 'Server error. Please try again later.' };
    }
    const data = await res.json();
    if (!res.ok) {
      return { success: false, message: data.message || 'Failed to subscribe. Please try again.' };
    }
    return { success: true, message: data.message || 'Successfully subscribed!', data };
  } catch {
    return { success: false, message: 'Network error. Please try again.' };
  }
}
