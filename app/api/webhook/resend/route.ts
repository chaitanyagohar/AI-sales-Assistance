import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
);

export async function POST(request: Request) {
  try {
    const payload = await request.json();

    // Resend triggers different event types; we want to catch incoming emails (replies)
    // Note: Depending on your Resend webhook configuration, incoming email events 
    // provide the sender's email address.
    const eventType = payload.type;
    
    if (eventType === 'email.delivered' || eventType === 'email.received') {
      const senderEmail = payload.data?.from || payload.data?.to; 
      // If an incoming email matches a lead's email, update their status
      if (senderEmail) {
        await supabase
          .from('leads')
          .update({ status: 'Replied 🎉' })
          .eq('email', senderEmail);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Webhook Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}