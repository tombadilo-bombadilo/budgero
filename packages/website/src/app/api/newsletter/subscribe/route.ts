import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { email, name } = await request.json();
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ success: false, message: 'Invalid email' }, { status: 400 });
    }

    const API_KEY = process.env.MAILERLITE_API_KEY;
    const GROUP_ID = process.env.MAILERLITE_GROUP_ID;
    if (!API_KEY) {
      return NextResponse.json(
        { success: false, message: 'Newsletter service not configured' },
        { status: 500 }
      );
    }

    const body = {
      email,
      fields: {
        name: name || '',
        source: 'budgero_website_v2',
        signup_date: new Date().toISOString(),
      },
      ...(GROUP_ID ? { groups: [GROUP_ID] } : {}),
    };

    const mlRes = await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      // Avoid caching
      cache: 'no-store',
    });

    const isJson = mlRes.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await mlRes.json() : null;

    if (mlRes.ok) {
      const isNewSubscriber = mlRes.status === 201;
      return NextResponse.json({
        success: true,
        message: isNewSubscriber
          ? 'Welcome to the waitlist! Check your email for confirmation.'
          : "You're already on our waitlist!",
        data,
      });
    }

    if (data?.errors) {
      const errorMessage = Object.values(data.errors as Record<string, string[]>)
        .flat()
        .join(', ');
      return NextResponse.json(
        { success: false, message: errorMessage || 'Please check your email address.' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, message: data?.message || 'Failed to subscribe. Please try again.' },
      { status: 400 }
    );
  } catch {
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
  }
}
