import { redirect } from 'next/navigation';

export const metadata = { title: 'Hoje · Tactia' };

export default function TodayPage() {
  redirect('/objectives');
}
