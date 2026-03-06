"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";

type SpecialAdCategory = "NONE" | "EMPLOYMENT" | "HOUSING" | "CREDIT";
type Objective =
  | "OUTCOME_TRAFFIC"
  | "OUTCOME_LEADS"
  | "OUTCOME_SALES"
  | "OUTCOME_ENGAGEMENT";

type FormState = {
  accessToken: string;
  adAccountId: string;
  campaignName: string;
  objective: Objective;
  category: SpecialAdCategory;
};

export default function Home() {
  const [form, setForm] = useState<FormState>({
    accessToken: "",
    adAccountId: "",
    campaignName: "",
    objective: "OUTCOME_TRAFFIC",
    category: "NONE",
  });

  const [result, setResult] = useState<unknown | null>(null);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    });
  };

  const createCampaign = async (): Promise<void> => {
    const res = await fetch("/api/createCampaign", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(form),
    });

    const data = await res.json();
    setResult(data);
  };

  return (
    <div style={{ padding: 40 }}>
      <h2>Create Meta Ads Campaign</h2>

      <Input
        placeholder="Access Token"
        name="accessToken"
        value={form.accessToken}
        onChange={handleChange}
      />

      <br /><br />

      <Input
        placeholder="Ad Account ID"
        name="adAccountId"
        value={form.adAccountId}
        onChange={handleChange}
      />

      <br /><br />

      <Input
        placeholder="Campaign Name"
        name="campaignName"
        value={form.campaignName}
        onChange={handleChange}
      />

      <br /><br />

      <Select
        value={form.objective}
        onValueChange={(value) => handleChange({ target: { name: "objective", value } })}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Objective" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="OUTCOME_TRAFFIC">Traffic</SelectItem>
            <SelectItem value="OUTCOME_LEADS">Leads</SelectItem>
            <SelectItem value="OUTCOME_SALES">Sales</SelectItem>
            <SelectItem value="OUTCOME_ENGAGEMENT">Engagement</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>

      <br /><br />

      <Select
        value={form.category}
        onValueChange={(value) => handleChange({ target: { name: "category", value } })}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="NONE">None</SelectItem>
            <SelectItem value="EMPLOYMENT">Employment</SelectItem>
            <SelectItem value="HOUSING">Housing</SelectItem>
            <SelectItem value="CREDIT">Credit</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <br /><br />

      <Button onClick={createCampaign}>
        Create Campaign
      </Button>

      <br /><br />

      {result !== null && (
        <pre>{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}