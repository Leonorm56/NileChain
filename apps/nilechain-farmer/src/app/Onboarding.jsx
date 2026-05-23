import Alert from "@/components/Alert";
import Connect from "@/partials/Connect";
import PrimaryButton from "@/components/PrimaryButton";
import WelcomeIcon from "@/assets/images/icon-unwrapped-cropped.png?format=webp&h=224";
import useAppContext from "@/hooks/useAppContext";
import { cn } from "@/utils";

export default function Onboarding() {
  const { dispatchAndConfigureSettings } = useAppContext();
  return (
    <div className="flex flex-col gap-2 justify-center min-h-dvh max-w-96 mx-auto p-4">
      {/* App Icon */}
      <div className="mx-auto p-1.5 rounded-2xl border-2 border-nile-gold-500/60 bg-white/30 dark:bg-white/[0.04]">
        <img src={WelcomeIcon} className="h-28 rounded-xl" />
      </div>

      {/* App Title */}
      <h3
        className={cn(
          "leading-none font-turret-road",
          "text-2xl text-center",
          "text-nile-gold-400"
        )}
      >
        {import.meta.env.VITE_APP_NAME}{" "}
      </h3>

      {/* Warning */}
      <Alert variant={"warning"}>
        By using the farmer, you accept full responsibility for any risks to
        your account. If you receive a ban, you alone are accountable.
      </Alert>

      {/* Get Started */}
      <PrimaryButton
        className="bg-nile-gold-600"
        onClick={() => dispatchAndConfigureSettings("onboarded", true, false)}
      >
        Get Started
      </PrimaryButton>

      {/* Connect */}
      <Connect className="hover:bg-nile-gold-600" />
    </div>
  );
}



