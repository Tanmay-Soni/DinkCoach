import { useState } from 'react';
import OnboardingFlow from './onboarding/OnboardingFlow';
import CoachApp from './CoachApp';

export default function App() {
  const [onboarded, setOnboarded] = useState(false);

  return onboarded ? (
    <CoachApp />
  ) : (
    <OnboardingFlow onComplete={() => setOnboarded(true)} />
  );
}
