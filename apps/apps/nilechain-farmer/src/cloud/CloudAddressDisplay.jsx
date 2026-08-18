import useAppContext from "@/hooks/useAppContext";

export default function CloudAddressDisplay() {
  const { settings } = useAppContext();

  return (
    <p className="p-2 text-center text-nile-gold-800 bg-nile-gold-100 rounded-lg">
      <span className="font-bold">Server</span>: {settings.cloudServer}
    </p>
  );
}



