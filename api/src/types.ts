export type Home = { id: string; name: string }
export type Member = { id: string; homeId: string; name: string }
export type Share = {
  id: string
  memberId: string
  amountCents: number
  paidAt: string | null
}
export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}
export type BillShare = Share & { memberName: string | null }
export type BillWithShares = Omit<Bill, 'shares'> & { shares: BillShare[] }
export type Balance = { memberId: string; name: string; outstandingCents: number }
export type HomeDetails = Home & { members: Member[] }
